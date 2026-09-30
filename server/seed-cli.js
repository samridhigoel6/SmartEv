import { connectDB,disconnectDB } from './db.js';
import { seedDatabase } from './seed.js';
await connectDB();await seedDatabase();console.log('Sample data ready. Existing records were preserved.');await disconnectDB();
