import 'dotenv/config';
import { connectDB, disconnectDB } from '../server/config/database.js';
import { migrateDatabase } from '../server/services/migrate.js';
import { provisionAdmin } from '../server/services/admin.js';
try {
  await connectDB(); await migrateDatabase();
  await provisionAdmin({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME || 'Workspace admin' });
  console.log('Administrator created.');
} finally { await disconnectDB(); }
