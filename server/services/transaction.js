import mongoose from 'mongoose';
import { Counter } from '../models/index.js';
export async function mutate(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // Every domain write takes this lock FIRST. MongoDB retries conflicting transactions,
      // so interval checks cannot race a booking insert, edit, cancellation or cascade.
      await Counter.updateOne({ _id: 'write-lock' }, { $inc: { value: 1 } }, { session });
      result = await fn(session);
    });
    return result;
  } finally { await session.endSession(); }
}
