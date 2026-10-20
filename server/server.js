import { connectDB, disconnectDB } from './config/database.js';
import { seedDatabase } from './seed.js';
import { migrateDatabase } from './services/migrate.js';
import { bootstrapAdmin } from './services/admin.js';
import { createApp } from './app.js';
await connectDB();
await migrateDatabase();
await seedDatabase();
await bootstrapAdmin();
const port = Number(process.env.PORT || 4000);
const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Smart EV API ready at http://127.0.0.1:${port}`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(); await disconnectDB(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
