import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { parseCookie as parse } from 'cookie';
import { User, Counter } from '../models/index.js';
import { AuthSession } from '../models/AuthSession.js';
import { mutate } from './transaction.js';
import { fail } from '../middleware/errors.js';
import { cookieName, hashToken, publicUser } from '../middleware/auth.js';
export function validateCredentials(body) {
  if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 254) fail('Enter a valid email address.');
  if (typeof body.password !== 'string' || body.password.length < 10 || Buffer.byteLength(body.password) > 72) fail('Use a password of at least 10 characters and no more than 72 bytes.');
  return { email: body.email.trim().toLowerCase(), password: body.password };
}
export const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
export async function createSession(user, req, res) {
  const old = parse(req.headers.cookie || '')[cookieName];
  if (old) await AuthSession.deleteOne({ tokenHash: hashToken(old) });
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await AuthSession.create({ tokenHash: hashToken(token), userId: user._id, csrfToken, expiresAt });
  res.cookie(cookieName, token, { ...cookieOptions(), expires: expiresAt });
  return { user: publicUser(user), csrfToken };
}
export async function register(body) {
  const { email, password } = validateCredentials(body);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) fail('Enter your name (up to 100 characters).');
  for (const key of Object.keys(body)) if (!['name', 'email', 'password', 'phone'].includes(key)) fail(`Unknown registration field: ${key}`);
  if (body.phone !== undefined && (typeof body.phone !== 'string' || body.phone.length > 30)) fail('Enter a valid phone number.');
  const passwordHash = await bcrypt.hash(password, 12);
  return mutate(async session => {
    const seq = await Counter.findOneAndUpdate({ _id: 'users' }, { $inc: { value: 1 } }, { upsert: true, new: true, session });
    const [user] = await User.create([{ user_id: seq.value, name: body.name.trim(), email, passwordHash, phone: body.phone || '', role: 'user', membership: 'Basic' }], { session });
    return user;
  });
}
// A valid dummy hash makes unknown-account logins perform the same expensive comparison.
const dummyHash = bcrypt.hash('unused-' + randomBytes(24).toString('hex'), 12);
export async function login(body) {
  const { email, password } = validateCredentials(body);
  const user = await User.findOne({ email }).select('+passwordHash');
  const matches = await bcrypt.compare(password, user?.passwordHash || await dummyHash);
  if (!user || !user.passwordHash || !matches) fail('Email or password is incorrect.', 401);
  return user;
}
