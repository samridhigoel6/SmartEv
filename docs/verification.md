# Verification record — 14 October 2026

## Executed successfully

- `npm run build`: production bundle generated successfully. The final application was restarted, and the migration comparison passed again against the persisted database.
- `npm test`: **18 integration tests passed**, using a real isolated MongoDB replica set. Covers seed fidelity, idempotency, bcrypt, cookie flags, CSRF/origin rejection, login/registration, private data scopes, role/ownership rejection, station search/connectors, validations, billing, adjacent/overlapping reservations, invalidating edits, moving reservations, simulated charging/payment, concurrent reservation races, cascades, aggregations, session expiry and logout.
- `npm run test:ui`: browser workflow passed in installed Chrome. Administrator login, driver registration, vehicle creation, station creation, reservation, status changes, simulated Paid receipt, page reload persistence, CSV export, unauthorized profile access, mobile navigation/width and logout were exercised. Uniquely named QA records were deleted afterward.
- Original `src/styles.css` compared byte-for-byte with its pre-integration snapshot: unchanged. New `auth.css` styles the added login screen and allows sidebar scrolling so the new sign-out button is reachable on small screens.
- Every pre-existing user, station, vehicle and booking was compared against the private `.data/before-integration.json` snapshot. Original IDs, references, names, statuses, dates, energy and bills were preserved in `smart_ev_charging`.

## Re-run

```sh
npm test
npm run build
```

With the application already running, run:

```sh
npm run test:ui
```

Browser testing uses `@playwright/test` and installed Google Chrome. To use Playwright Chromium instead, install that browser (`npx playwright install chromium`) and set `PLAYWRIGHT_BROWSER=chromium`. The script reads the private local admin file or `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`; `E2E_URL` optionally changes the target URL. Never target a production deployment. The test creates a unique QA driver and station, then removes only that account and its related test records in a `finally` block.

Screenshots from this workspace are in ignored `tmp/integration/` and contain test data. No credentials are included in screenshots or logs.

## Scope and limitations

Local MongoDB was tested; no Atlas cluster credentials were supplied, so Atlas-specific network/TLS configuration was not exercised. Charging and payment are explicitly simulated. No physical charger, payment gateway, GPS integration, email verification, password-reset flow or multi-connector station UI is claimed. The development login rate limiter is in-process; a distributed deployment would need a shared limiter store. Source profiles without credentials remain historical records rather than login accounts.
