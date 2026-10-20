# MongoDB design and viva guide

## Collections and relationships

The UI has four core domain entities. Their original fields and references are retained. Do not confuse conceptual embedded records with independent collections.

| Collection | Main fields and constraints |
|---|---|
| `users` | `user_id` unique numeric display ID; required trimmed name; membership enum; optional unique normalized email and bcrypt passwordHash for login accounts; phone; role enum; timestamps |
| `vehicles` | unique vehicle_id; required User reference user_id; required model_name and plug_type enum; optional unique registrationNumber and positive batteryCapacity; timestamps |
| `stations` | unique station_id; required name/address/plug and owner reference; status enum; embedded connector powerRating and pricePerKWh; timestamps |
| `bookings` | unique booking_id; required User/Station/Vehicle references; valid start/end; nonnegative energy/bill; status enum; tariff/discount snapshots; embedded session and payment; timestamps |
| `authsessions` | unique tokenHash; User reference; CSRF token; expiresAt with TTL index; timestamps |
| `counters` | unique string key and numeric value; display ID sequences, transaction write lock, migration/seed markers |

`User 1 → many Vehicles`, `User 1 → many Stations`, `User 1 → many Bookings`, `Station 1 → many Bookings`, `Vehicle 1 → many Bookings`.

One station represents one charging connector in this frontend. Connector identity is the station ObjectId, while connector type/status use the existing station fields. Power and tariff are embedded in `station.connector`. This avoids two separate documents for a mandatory one-to-one record. A booking embeds at most one `charging_session` and one latest `payment`, because they share its lifecycle and are normally read together. Separate session/payment history endpoints project these embedded records. Payments do not record card/bank details or real transactions.

Original sample profiles do not have email/password fields; they remain valid historical driver records and cannot sign in. Registration requires name, valid unique email and password. Role always starts as user. Admin provisioning is an explicit server-side step or a generated private local bootstrap.

## Meaningful DBMS concepts

1. **CRUD:** protected Express controllers call Mongoose find/create/save/delete; existing UI forms use Fetch and refresh after successful writes.
2. **Schema validation:** required names, enum memberships/statuses/plugs, bounded text, positive capacities, nonnegative energy/cost, and end-after-start validation.
3. **Document references:** ObjectId relations model ownership and bookings. Services verify related records and vehicle ownership inside the transaction; MongoDB itself does not provide SQL foreign keys.
4. **Embedded documents:** connector pricing/power, simulated charging session and payment receipt are bounded one-to-one data.
5. **Unique constraints:** numeric display IDs, real email strings and supplied vehicle registration numbers. Partial indexes let legacy profiles omit email and vehicles omit registration without conflicting on null.
6. **Compound indexes:** station type/status; booking station/status/start/end; vehicle/status/start/end; user/start_time. These support filtered listings, interval checks and user history.
7. **Aggregation:** reports first `$match` the authorized user scope, `$lookup` bookings/stations, `$group` sums/counts, `$project` only safe fields, and `$sort` revenue. Users with zero bookings remain in billing summaries.
8. **Transactions:** create/update/delete/cascade and membership changes use `session.withTransaction`. Successful callbacks commit; errors abort all changes, including station availability and counters.
9. **Atomic concurrency control:** each domain transaction first increments one `write-lock` counter. Concurrent transactions conflict on this document; Mongoose retries them with a fresh snapshot. Availability checks and inserts occur only after that write. This prevents the check-then-insert race across clients and server processes. All domain writes must use this service path; direct database writes bypass application constraints.
10. **TTL index:** authentication sessions expire automatically, but request middleware independently checks expiry because TTL cleanup is asynchronous.

## Booking and charging logic

An interval is `[start_time, end_time)`. An overlap exists only when both `old.start_time < new.end_time` and `old.end_time > new.start_time`. A Reserved/Charging booking reserves its station connector and vehicle during that interval. Back-to-back intervals are valid. A connector stays marked Occupied while it has any active reservation; the interval endpoint can still identify later available slots. A manually occupied station with no active reservation remains unavailable until an administrator releases it.

New bookings snapshot the connector tariff and current membership discount. Driver bills are `round(energy × snapshot rate × (1 − discount / 100), 2)`. Admins retain manual historical bill adjustments to preserve the existing UI/source data. Historical bills from the original SQL are not recalculated during migration.

Changing booking state to Charging creates a simulated session timestamp. Completion records measured-input energy and cost; it does not derive real consumption from elapsed time. The simulated payment uses the final stored bill. A second Paid request returns the existing receipt, and a paid booking cannot be edited.

## Referential integrity and deletion

Deleting a user through the administrator UI deletes their vehicles, owned stations, all bookings that reference these records, and their authentication sessions. Deleting a station/vehicle cascades its bookings. Affected remaining stations are released if no active bookings remain. All steps run in one transaction, and the confirmation endpoint previews affected counts.

Legacy imported bookings may have mismatched plugs from before the original SQL compatibility trigger. They retain their completed pairing; new connections and new bookings must match. The API never accepts a client-supplied legacy flag, password hash, price snapshot, payment amount or administrator role.

## Communication flow

`React form → Fetch /api with cookie + CSRF header → Express auth/validation → service transaction → Mongoose → MongoDB replica set → populated JSON → refreshed React state`.

The browser never receives the MongoDB URI or password hashes. A regular user’s filters are applied on the server even if they bypass the UI.

## Source references

- [Mongoose transactions](https://mongoosejs.com/docs/transactions.html)
- [MongoDB multi-document transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [MongoDB indexes](https://www.mongodb.com/docs/manual/indexes/)
