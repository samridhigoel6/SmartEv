import { connectDB, disconnectDB } from './config/database.js';
import { migrateDatabase } from './services/migrate.js';
import { seedDatabase } from './seed.js';
try { await connectDB(); await migrateDatabase(); await seedDatabase(); console.log('Sample data ready. Existing records preserved.'); } finally { await disconnectDB(); }
