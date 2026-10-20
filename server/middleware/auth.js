import { createHash } from 'node:crypto';
import { parseCookie as parse } from 'cookie';
import { AuthSession } from '../models/AuthSession.js';
import { fail } from './errors.js';
export const cookieName = 'smart_ev_session';
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const publicUser = user => ({ _id: user._id, user_id: user.user_id, name: user.name, email: user.email, phone: user.phone, membership: user.membership, role: user.role });
export async function authenticate(req, res, next) {
  const token = parse(req.headers.cookie || '')[cookieName];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) fail('Please sign in to continue.', 401);
  const session = await AuthSession.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).populate('userId');
  if (!session?.userId) fail('Your session has expired. Please sign in again.', 401);
  req.authSession = session; req.user = session.userId;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-csrf-token') !== session.csrfToken) fail('Invalid security token. Refresh the page and try again.', 403);
  next();
}
export function adminOnly(req, res, next) { if (req.user.role !== 'admin') fail('Administrator access is required.', 403); next(); }
export function sameOrigin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') fail('Cross-site requests are not allowed.', 403);
    if (origin) {
      let host; try { host = new URL(origin).host; } catch { fail('Invalid origin.', 403); }
      if (host !== req.get('host')) fail('Cross-origin writes are not allowed.', 403);
    }
  }
  next();
}
