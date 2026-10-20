# Project structure and integration changes

```text
SmartEv/
├── src/
│   ├── App.jsx                 # Existing pages/forms, now auth-aware
│   ├── Auth.jsx                # Login/registration gate and user context
│   ├── api.js                  # Same-origin Fetch, CSRF and expiry handling
│   ├── auth.css                # Login screen and sign-out accessibility
│   ├── styles.css              # Existing dashboard styles — unchanged
│   └── main.jsx                # Auth provider wrapping existing app
├── server/
│   ├── server.js               # Database/migration/seed/admin/server startup
│   ├── index.js                # Compatible entry point
│   ├── app.js                  # Express middleware and route assembly
│   ├── config/database.js      # Persistent replica set/Atlas connection
│   ├── db.js                   # Compatible database export
│   ├── models/
│   │   ├── index.js            # Existing four domain schemas + embedded records
│   │   └── AuthSession.js      # Expiring hashed authentication sessions
│   ├── models.js               # Compatible schema export
│   ├── routes/{auth,api}.js
│   ├── controllers/{auth,records}.js
│   ├── middleware/{auth,errors}.js
│   ├── services/
│   │   ├── auth.js             # bcrypt, registration, login, session creation
│   │   ├── admin.js            # Safe administrator provisioning
│   │   ├── records.js          # Owned CRUD, intervals, cascades, simulation
│   │   ├── reports.js          # Scoped aggregation pipelines
│   │   ├── transaction.js      # Shared transaction lock
│   │   └── migrate.js          # Idempotent schema/data migration
│   ├── seed.js                 # Original realistic sample data
│   ├── seed-cli.js
│   └── dev.js                  # Existing development process runner
├── scripts/create-admin.js
├── tests/
│   ├── api.test.js             # Isolated real MongoDB integration tests
│   └── browser.test.mjs        # Browser workflows and mobile checks
├── docs/
│   ├── api.md
│   ├── schema.md
│   ├── implementation-plan.md
│   ├── project-structure.md
│   └── verification.md
├── .env.example
├── .gitignore
├── package.json / package-lock.json
├── README.md
└── .data/                      # Ignored private local database and credentials
```

Created: Auth UI/API helper/style, modular config/models/routes/controllers/middleware/services, server.js, administrator CLI, and integration documentation.

Modified: App.jsx, main.jsx, app.js, db.js, models.js, index.js, seed.js, seed-cli.js, API integration tests, package manifests, environment example, gitignore, README and schema guide.

Preserved: styles.css, existing frontend page layouts/components, favicon, index.html, Vite proxy configuration, development runner, original sample names/vehicles/stations/history and original smart_ev database. No PostgreSQL/SQL migration was performed.
