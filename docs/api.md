# REST API reference

Base path: `/api`. Responses are JSON. Errors use `{ "error": "message" }`. IDs are MongoDB ObjectId strings. Existing snake_case domain fields remain compatible with the frontend; `_id` is the reference identifier and `*_id` numeric values on the corresponding root entity are display IDs.

## Authentication

| Method | Path | Body / result |
|---|---|---|
| POST | `/auth/register` | `{name,email,password,phone?}` → user and CSRF token; creates a driver |
| POST | `/auth/login` | `{email,password}` → user and CSRF token |
| GET | `/auth/me` | Current safe profile and CSRF token |
| POST | `/auth/logout` | Invalidate cookie/session; 204 |
| GET | `/health` | Connection status and database name; public |

Login/registration set the HTTP-only session cookie. Use cookie credentials on subsequent requests and send `X-CSRF-Token` from the authentication response on writes. All endpoints below require authentication. Requests are same-origin; the Vite proxy forwards `/api` to Express.

## Existing CRUD

For `users`, `vehicles`, `stations`, and `bookings`:

| Method | Path | Description |
|---|---|---|
| GET | `/:collection` | Scoped populated list |
| GET | `/:collection/:id` | Scoped populated detail |
| POST | `/:collection` | Create a record |
| PUT/PATCH | `/:collection/:id` | Update supplied allowed fields |
| DELETE | `/:collection/:id` | Delete with transactional cascades |
| GET | `/:collection/:id/delete-impact` | Preview affected counts |

Admin: full domain CRUD, excluding deleting the currently signed-in admin account. Drivers: own name/phone, own vehicles and bookings; cannot manage stations or create/delete user profiles. Drivers cannot delete charging/completed history or vehicles containing that history. Paid bookings cannot be edited. Admin cascade deletion remains available with its existing confirmation.

### Allowed domain fields

- Users: `name`, `membership` (admin only), `phone`. Authentication fields are managed by registration/provisioning, never generic CRUD.
- Vehicles: `user_id`, `model_name`, `plug_type`, optional `registrationNumber`, `batteryCapacity`.
- Stations (admin): `name`, `address`, `supported_plug`, `current_status`, `user_id`, `connector: {powerRating, pricePerKWh}`.
- Bookings: `user_id`, `vehicle_id`, `station_id`, `start_time`, `end_time`, `status`, `energy_used_kwh`, `total_bill`. The server recalculates driver bills. Admins can enter manual historical totals.

## Station and booking workflow

| Method | Path | Details |
|---|---|---|
| GET | `/stations?search=...&location=...&connectorType=CCS2&status=Available` | Escaped text search and filters |
| GET | `/stations/:id/connectors` | The station’s single embedded connector |
| GET | `/stations/:id/availability?startTime=ISO&endTime=ISO&exclude=bookingId` | Interval availability; advisory only, writes revalidate transactionally |
| POST | `/bookings/:id/cancel` | Cancel the owned reservation and release availability |
| POST | `/bookings/:id/start` | Start a simulated charging session |
| POST | `/bookings/:id/end` | Complete; optional `{energy_used_kwh: number}`; calculate final cost |
| GET | `/charging-sessions` | Scoped embedded session history |
| POST | `/bookings/:id/payment` | `{status: "Paid"}` or `{status: "Failed"}`; simulation only |
| GET | `/payments` | Scoped simulated receipt history |

Two intervals overlap when `existing.start < requested.end` and `existing.end > requested.start`. The half-open convention allows one booking to end exactly when another begins. Both connector and vehicle overlaps are prevented for Reserved/Charging records. Completed/Cancelled records do not reserve inventory.

## Dashboards

| Method | Path | Details |
|---|---|---|
| GET | `/overview` or `/dashboard` | Stations plus scoped users, vehicles and bookings |
| GET | `/reports` | Scoped user billing, station revenue, available stations, booking details |
| POST | `/actions/upgrade-members` | Admin-only, idempotent Premium upgrade for two or more non-cancelled bookings |

## Common status codes

200 read/update; 201 create; 204 delete/logout; 400 validation; 401 unauthenticated/expired; 403 CSRF/role/owner restrictions; 404 inaccessible or absent detail; 409 overlap, duplicate email/registration or invalid state; 429 sign-in throttling.
