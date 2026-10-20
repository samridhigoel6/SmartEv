import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { User, Counter } from '../models/index.js';
import { mutate } from './transaction.js';
import { validateCredentials } from './auth.js';
export async function provisionAdmin({ email, password, name = 'Workspace admin' }) {
  const credentials = validateCredentials({ email, password });
  const passwordHash = await bcrypt.hash(credentials.password, 12);
  return mutate(async session => {
    const existing = await User.findOne({ email: credentials.email }).session(session);
    if (existing) throw new Error('An account already uses ADMIN_EMAIL. No role or password was changed.');
    const seq = await Counter.findOneAndUpdate({ _id: 'users' }, { $inc: { value: 1 } }, { new: true, upsert: true, session });
    const [admin] = await User.create([{ user_id: seq.value, name, email: credentials.email, passwordHash, role: 'admin', membership: 'Premium' }], { session });
    return admin;
  });
}
export async function bootstrapAdmin() {
  if (await User.exists({ role: 'admin' })) return;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await provisionAdmin({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME || 'Workspace admin' });
    return;
  }
  if (process.env.MONGODB_URI || process.env.NODE_ENV === 'production') throw new Error('First setup requires ADMIN_EMAIL and ADMIN_PASSWORD in your environment, or npm run admin.');
  const email = 'admin@smart-ev.local';
  const password = randomBytes(18).toString('base64url');
  await mkdir('.data', { recursive: true });
  // Write before creating the account so a filesystem error cannot leave an inaccessible admin.
  await writeFile('.data/admin-login.txt', `Smart EV local administrator\nEmail: ${email}\nPassword: ${password}\n\nKeep this file private. It is excluded from Git.\n`, { mode: 0o600 });
  await provisionAdmin({ email, password });
  console.log('Local admin credentials created in .data/admin-login.txt (private file).');
}
