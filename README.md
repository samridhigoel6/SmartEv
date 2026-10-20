# Smart EV — MongoDB integration

The existing React/Vite application, now connected to a protected Express/Mongoose backend and the **`smart_ev_charging`** database. Existing dashboard CSS, layout, charts and responsive rules are preserved. Authentication adds a matching sign-in screen; existing booking dialogs include clearly labeled simulated charging/payment information.

## Run locally

Requires **Node.js 22+** (24 recommended), npm, and internet for the first dependency/MongoDB binary download.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173/**. API: **http://127.0.0.1:4000/api**.

On first local startup, a real MongoDB replica set starts using WiredTiger disk storage in `.data/mongodb/`. The generated administrator email and password are saved in **`.data/admin-login.txt`**, with owner-only permissions. Read this private file to sign in. There is no hardcoded default password. New drivers use **Create an account** on the sign-in screen. Original sample driver profiles have no passwords and cannot log in.

The local database persists across restarts. Stop the app with Ctrl+C. Despite its package name, `mongodb-memory-server` launches a real native MongoDB process; the application database is stored on disk, not in browser storage or an in-memory mock.

Separate frontend/backend commands:

```sh
npm run dev:server
npm run dev:client
```

Build and serve with Express:

```sh
npm run build
npm start
```

The built app is available at **http://127.0.0.1:4000/**. By default this is still local development. In production, set `NODE_ENV=production`, supply an external replica set/Atlas URI, and serve behind HTTPS; production session cookies have `Secure` enabled. Do not set production mode for plain HTTP local testing.

## MongoDB Atlas or an existing replica set

Copy `.env.example` to `.env`. Set:

```dotenv
MONGODB_URI=<your MongoDB replica-set or Atlas connection string>
MONGODB_DB=smart_ev_charging
ADMIN_EMAIL=<your administrator email>
ADMIN_PASSWORD=<a unique password of at least 10 characters>
ADMIN_NAME=Workspace admin
```

Keep all credentials private. A standalone `mongod` is intentionally rejected: multi-document transactions need a replica set or supported Atlas cluster. The built-in local launcher already sets this up. No SQL/PostgreSQL dependencies are used.

On an empty external database, startup creates the sample data and provisions the specified administrator. Once an administrator exists, startup does not reset passwords or promote other accounts. To create an additional administrator, stop the local app first (or use an external MongoDB connection), set a new email/password in the environment, then run:

```sh
npm run admin
```

This command refuses to overwrite an existing email. Remove `ADMIN_PASSWORD` from `.env` after provisioning if desired. Regular registration always creates a `user`, never an administrator.

## Existing data and migration

The previous app used `smart_ev`. On the built-in local deployment, startup copies its users, vehicles, stations, bookings and numeric counters into `smart_ev_charging` **only if the target database is empty and uninitialized**. It preserves ObjectIds, numeric IDs, timestamps, membership, bills, and existing bookings. The original database is not deleted or modified. The migration is transactional and recorded by the `integration-v2` counter; it will not import again on later starts, including after records are deleted. External MongoDB connections do not automatically read another database.

The current workspace also has a private pre-integration snapshot at `.data/before-integration.json`. Neither database files nor credentials are committed to Git.

## Existing features connected

- **Overview:** real station availability, user-scoped energy/billing totals, chart data and booking history.
- **Stations:** search by name/location, connector/status filters, details, embedded connector data, and administrator CRUD.
- **Vehicles:** owned vehicle CRUD; optional registration number and capacity are supported by the API.
- **Bookings:** CRUD, interval availability feedback, cancellation, plug and owner validation, and transaction-safe conflict prevention. Admins can manage all bookings; drivers only their own.
- **Charging:** changing booking status to Charging/Completed in the existing form starts/ends an embedded simulated session. Dedicated start/end endpoints support the same workflow. Energy is manually entered simulated meter data, not live telemetry.
- **Billing:** current tariff is read from the selected station and snapshotted on a booking; new Basic memberships receive the source’s 10% discount. Drivers’ bills are calculated on the server. Admins retain the existing manual bill field for historical adjustments.
- **Payments:** completed booking dialogs can mark a clearly labeled simulated payment Paid or Failed. The server uses the recorded bill, never a client-supplied payment amount. Paid receipts are idempotent and lock booking edits. No real money is transferred.
- **Users/Insights:** own profile and billing for drivers, full management and membership upgrades for admins, CSV export.

Source history is preserved, including pre-trigger connector mismatches marked Legacy. New pairings must match. Cancelled reservations have zero energy/bill. A station represents exactly one connector; multi-port stations are outside the existing UI. Future non-overlapping reservations at the same connector are permitted. `Occupied` without any reservation represents manual unavailability from the original dataset.

## Authentication and security

Bcrypt cost 12 hashes passwords. Opaque random session tokens are sent only in HTTP-only, SameSite=Strict cookies and stored as SHA-256 digests in MongoDB. Sessions expire after 24 hours; expiry is checked on requests and a TTL index removes old session documents. Login replaces the previous browser session; logout invalidates it server-side. Password hashes are excluded from API responses.

All application data endpoints require authentication. Writes require a session CSRF token; origin checks and same-origin Fetch/Vite proxy avoid permissive CORS. Login/registration are rate-limited. Controllers whitelist fields; lookup filters are constructed by the server, with IDs and numeric/date values validated. Driver access is scoped on lists, detail requests, reports, charging history, payments, updates and deletion previews. Drivers cannot assign admin roles, modify memberships, manage stations or access other users’ private records.

## Tests and documentation

```sh
npm test
npm run build
```

Integration tests use an isolated native MongoDB replica set and a separate database. They never reset application data. Browser smoke checks are described in [verification](docs/verification.md).

- [API reference](docs/api.md)
- [Schemas, relationships and DBMS viva](docs/schema.md)
- [Project structure and changed files](docs/project-structure.md)
- [Original audit and implementation plan](docs/implementation-plan.md)

## Sample data

`server/seed.js` is the idempotent seed script based on the original SQL assignment: 10 sample profiles, 10 vehicles, 10 stations and 9 final historical bookings on a fresh database. Existing databases are preserved instead of reseeded. The generated administrator is additional.

```sh
npm run seed
```

Stop the built-in local app before running this standalone command, since two MongoDB processes cannot open the same database directory. There are no SQL migrations: MongoDB schema/data migration is in `server/services/migrate.js`.

## What is deliberately simulated or not included

Charging start/end and energy readings are demonstrations with `simulated: true`; there is no charger hardware connection. Payment receipts also use `simulated: true`, and no payment gateway, bank/card data or external service is used. The existing app has no map, so GeoJSON/GPS is not introduced. Password reset/email verification and multi-connector station management are not implemented. No public deployment is performed by this integration.
