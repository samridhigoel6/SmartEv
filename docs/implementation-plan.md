# Integration plan based on the existing repository

Audit: React 19/Vite, a single App.jsx with Overview, Stations, Bookings, Vehicles, Users and Insights; existing modal CRUD forms, filters, CSV export, Recharts charts, mobile navigation. Express 5 and MongoDB/Mongoose already provide CRUD, joins, aggregation, cascade deletion, and replica-set transactions. Dashboard values already come from MongoDB. Hardcoded functional values are the signed-in identity and suggested tariff. No authentication, authorization, session receipts or payments exist. The current booking lock blocks all active reservations instead of only overlapping intervals.

1. Preserve src/styles.css and existing view/component structure. Add an authentication gate using the existing styles, dynamic profile, permissions and contextual simulated-payment controls.
2. Keep the four domain collections and source field names for compatibility. Embed a single connector in each station and session/payment records in each booking, matching the single-connector UI. Add a dedicated expiring authentication-session collection.
3. Use smart_ev_charging; copy existing smart_ev data only when the new database is empty. Preserve the original database and document migration. Local MongoDB stays a persistent replica set; Atlas/external connections must support transactions.
4. Extract existing CRUD into services/controllers/routes, preserve current endpoints, and add protected authentication, availability, charging and simulated-payment endpoints. Use bcrypt, opaque HTTP-only cookies, CSRF validation, and role/ownership checks on both reads and writes.
5. Keep the transaction write lock and perform interval checks inside that transaction. Add useful compound/unique indexes and snapshot tariffs for billing.
6. Test real MongoDB, authentication, isolation, interval races, cascades, charging, payments, browser workflows, reload persistence and unchanged CSS. Document schemas, API, startup, migration and viva concepts.
