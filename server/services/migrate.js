import mongoose from 'mongoose';
import { models, Counter, Station, Booking, User } from '../models/index.js';
import { AuthSession } from '../models/AuthSession.js';
export async function migrateDatabase({ copyLegacy = !process.env.MONGODB_URI } = {}) {
  for (const model of [...Object.values(models), Counter, AuthSession]) await model.init();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Counter.updateOne({ _id: 'write-lock' }, { $inc: { value: 1 } }, { upsert: true, session });
      if (await Counter.exists({ _id: 'integration-v2' }).session(session)) return;
      const target = mongoose.connection.db;
      const legacy = mongoose.connection.getClient().db('smart_ev');
      let targetHasData = false;
      for (const name of Object.keys(models)) { if (await target.collection(name).countDocuments({}, { session })) targetHasData = true; }
      if (copyLegacy && target.databaseName !== 'smart_ev' && !targetHasData && await legacy.collection('users').countDocuments({}, { session })) {
        for (const name of Object.keys(models)) {
          const documents = await legacy.collection(name).find({}, { session }).toArray();
          if (documents.length) await target.collection(name).insertMany(documents, { session });
        }
        const counters = await legacy.collection('counters').find({ _id: { $nin: ['write-lock', 'integration-v2'] } }, { session }).toArray();
        for (const counter of counters) await Counter.updateOne({ _id: counter._id }, { $set: { value: counter.value } }, { upsert: true, session });
      }
      await User.updateMany({ role: { $exists: false } }, { $set: { role: 'user', phone: '' } }, { session });
      await Station.updateMany({ connector: { $exists: false } }, { $set: { connector: { powerRating: 50, pricePerKWh: 0.5 } } }, { session });
      const bookings = await Booking.find({ charging_session: { $exists: false }, status: 'Completed' }).session(session);
      for (const booking of bookings) {
        booking.charging_session = { startTime: booking.start_time, endTime: booking.end_time, energyConsumed: booking.energy_used_kwh, totalCost: booking.total_bill, sessionStatus: 'Completed', simulated: true };
        await booking.save({ session });
      }
      for (const [kind, model] of Object.entries(models)) {
        const field = kind === 'users' ? 'user_id' : kind === 'stations' ? 'station_id' : kind === 'vehicles' ? 'vehicle_id' : 'booking_id';
        const latest = await model.findOne().sort({ [field]: -1 }).session(session);
        if (latest) await Counter.updateOne({ _id: kind }, { $max: { value: latest[field] } }, { upsert: true, session });
      }
      // Preserve an existing database even if it had no original seed marker.
      if (await User.exists({}).session(session)) await Counter.updateOne({ _id: 'seed-initialized' }, { $set: { value: 1 } }, { upsert: true, session });
      await Counter.updateOne({ _id: 'integration-v2' }, { $set: { value: 1 } }, { upsert: true, session });
    });
  } finally { await session.endSession(); }
}
