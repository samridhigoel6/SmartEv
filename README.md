# Smart EV

A complete MERN charging management application based on the supplied Smart EV ER diagram and `EV Mini Project.pdf`. React + Vite frontend, Express/Node REST API, and real MongoDB with Mongoose. Records are not stored in localStorage or a mock JSON database.

## Run locally

Requires Node.js 20.19+ (Node 22 or 24 recommended), npm, and internet access for the initial dependency and MongoDB binary downloads.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens on **http://127.0.0.1:4000**. On first start, the app downloads MongoDB 7.0.14 and starts a single-node replica set. It uses the WiredTiger engine and persists the database in `.data/mongodb/`. Despite the development launcher’s name (`mongodb-memory-server`), the app uses an actual MongoDB process and durable on-disk data. Wait for “MongoDB connected” on the first launch. Stop using Ctrl+C.

To use your own MongoDB or Atlas database, copy `.env.example` to `.env` and set `MONGODB_URI`. Transactions require a **replica set**. The application database is `smart_ev`. Sample data is imported only into an empty, uninitialized database; it never replaces an existing dataset. Do not run `npm run seed` concurrently with the default local server, because both would open the same local database directory.

```sh
npm run build
npm start
```

The production build is served by Express at **http://127.0.0.1:4000**. Both development services bind to localhost. This project is a local admin/demo application with no authentication. Before public deployment, add authentication, role-based authorization, rate limits, TLS and an appropriate hosting/network configuration. Keep `.env` and `.data` private. The required native MongoDB/Express backend is not deployed to the Sites Cloudflare runtime; a real public deployment needs a Node host and MongoDB.

## What you can do

- **Overview:** real database totals, energy/revenue chart, network availability, recent bookings.
- **Charging stations:** create, browse, search, filter, edit, delete, and start a booking. Grid and table views.
- **Bookings:** create/read/update/delete; driver-owned vehicle selection; plug validation; reservations, charging, completion and cancellation; energy and billing.
- **Vehicles:** CRUD, owner relations and plug filters.
- **Users:** CRUD, memberships and cascade deletion previews.
- **Insights & billing:** user billing summary, station revenue ranking, CSV export, and the SQL rule upgrading drivers with at least two bookings to Premium.
- Responsive navigation, keyboard-operable dialogs, validation and request feedback.

All charts, summaries and counts derive from MongoDB records. The app refreshes after every mutation and polls every 30 seconds.

## Source fidelity and choices

The data model retains every SQL field. Human-readable numeric IDs are preserved alongside MongoDB ObjectIds. References use ObjectIds; the numeric IDs appear in the interface as `USR-001`, `STN-001`, `EV-001`, and `BK-001`.

The SQL document, which is treated as reference data rather than instructions, is authoritative where it adds fields to the diagram: station ownership (`Stations.user_id`) is included. The seed matches the document’s **final** state: 10 users, 10 vehicles, 10 stations and 9 bookings (booking 1 was deleted), with the Basic membership discount already reflected in historical bills. Original SQL timestamps are interpreted in Asia/Kolkata. Seed records are examples from the assignment, not live charger telemetry.

Historical bookings include connector mismatches predating the SQL trigger. These are retained as completed `legacy_import` records and marked “Legacy.” The original pairing can remain on a completed historical record; new pairings and all new bookings must match. No user-facing CRUD request can set the import flag.

The source does not specify a currency. The display defaults to **INR**, configurable using `VITE_CURRENCY` before building. This changes the label/format, not stored amounts. New booking forms suggest the source’s 0.50 per kWh, with 10% off for Basic members. The amount can be edited; no payment is collected and discounts are never repeatedly compounded onto existing bills.

`status` is an added booking field: Reserved, Charging, Completed, Cancelled. Reserved/Charging occupy a whole station until completed, cancelled or deleted, extending the source’s insert/delete availability triggers. This is a single-connector reservation model: simultaneous active reservations at one station are blocked even for different future time slots. Time-range scheduling and multi-port capacity are outside the supplied model.

Deletion follows SQL `ON DELETE CASCADE`. Deleting a user removes their vehicles, owned stations and any bookings referencing those records, including bookings by other users at the deleted stations. The confirmation shows all affected record counts. Related writes and availability updates run in MongoDB transactions. A transaction lock serializes mutations to prevent cross-client booking conflicts in this mini-project.

## API

For each of `users`, `stations`, `vehicles`, `bookings`:

| Method | Endpoint | Action |
|---|---|---|
| GET | `/api/:collection` | Read populated records |
| GET | `/api/:collection/:id` | Read one record by ObjectId |
| POST | `/api/:collection` | Create |
| PUT | `/api/:collection/:id` | Update supplied fields |
| DELETE | `/api/:collection/:id` | Delete with cascades |
| GET | `/api/:collection/:id/delete-impact` | Preview deletion counts |

`GET /api/overview` returns the four populated collections. `GET /api/reports` returns billing, station revenue, available stations and booking details. `POST /api/actions/upgrade-members` runs the Premium upgrade rule. `GET /api/health` reports connectivity. Error responses contain `{ "error": "message" }`. Reference fields in writes must be ObjectId strings.

See [SQL to MongoDB mapping](docs/schema.md) for the assignment explanation.

## Verification

```sh
npm test
npm run build
```

The integration suite uses a separate ephemeral MongoDB replica set/database and never touches application records. It verifies CRUD, transactions, referential validation, connector mismatch rejection, billing aggregation, availability transitions, moving bookings, cascading deletion, concurrent reservation prevention and source seed fidelity.
