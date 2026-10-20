import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
// Pass the currently running local MongoDB URI; never commit an Atlas password.
const uri = process.env.EVIDENCE_MONGODB_URI;
if (!uri) throw new Error('Set EVIDENCE_MONGODB_URI to the running local MongoDB URI.');
const base = process.env.EVIDENCE_API_URL || 'http://127.0.0.1:4000/api';
const credentials = await readFile('.data/admin-login.txt', 'utf8');
const email = credentials.match(/^Email: (.+)$/m)[1];
const password = credentials.match(/^Password: (.+)$/m)[1];
let cookie, csrf, userId;
const evidence = { capturedAt: new Date().toISOString(), steps: [] };
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = res.status === 204 ? null : await res.json();
  return { status: res.status, body: value, cookie: res.headers.getSetCookie()[0] };
}
try {
  await mongoose.connect(uri, { dbName: 'smart_ev_charging', directConnection: true });
  const db = mongoose.connection.db;
  const hello = await db.admin().command({ hello: 1 });
  evidence.connection = { database: mongoose.connection.name, readyState: mongoose.connection.readyState, ping: await db.command({ ping: 1 }), replicaSet: hello.setName, isWritablePrimary: hello.isWritablePrimary, collections: (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort() };
  evidence.health = (await api('GET', '/health')).body;
  const login = await api('POST', '/auth/login', { email, password });
  assert.equal(login.status, 200); cookie = login.cookie.split(';')[0]; csrf = login.body.csrfToken;
  const u = await api('POST', '/users', { name: 'Submission Demo Driver', membership: 'Basic' });
  assert.equal(u.status, 201); userId = u.body._id;
  const payload = { user_id: userId, model_name: 'Submission Demo EV', plug_type: 'CCS2', batteryCapacity: 40 };
  const created = await api('POST', '/vehicles', payload); assert.equal(created.status, 201);
  const id = created.body._id;
  const query = { _id: new mongoose.Types.ObjectId(id) };
  const projection = { _id: 1, vehicle_id: 1, user_id: 1, model_name: 1, plug_type: 1, batteryCapacity: 1 };
  const direct = () => db.collection('vehicles').findOne(query, { projection });
  evidence.steps.push({ operation: 'Create', method: 'POST', path: '/api/vehicles', request: payload, status: created.status, mongoDocument: await direct() });
  assert.equal(evidence.steps.at(-1).mongoDocument.model_name, payload.model_name);
  const read = await api('GET', `/vehicles/${id}`); assert.equal(read.status, 200); assert.equal(read.body._id, id);
  evidence.steps.push({ operation: 'Read', method: 'GET', path: `/api/vehicles/${id}`, status: read.status, response: { _id: read.body._id, model_name: read.body.model_name, plug_type: read.body.plug_type }, mongoDocument: await direct() });
  const update = { model_name: 'Submission Demo EV Updated', batteryCapacity: 55 };
  const updated = await api('PUT', `/vehicles/${id}`, update); assert.equal(updated.status, 200);
  const stored = await direct(); assert.equal(stored.model_name, update.model_name); assert.equal(stored.batteryCapacity, 55);
  evidence.steps.push({ operation: 'Update', method: 'PUT', path: `/api/vehicles/${id}`, request: update, status: updated.status, mongoDocument: stored });
  const deleted = await api('DELETE', `/vehicles/${id}`); assert.equal(deleted.status, 204);
  const missing = await api('GET', `/vehicles/${id}`); assert.equal(missing.status, 404); assert.equal(await direct(), null);
  evidence.steps.push({ operation: 'Delete', method: 'DELETE', path: `/api/vehicles/${id}`, status: deleted.status, followupGetStatus: missing.status, mongoDocument: null });
  evidence.assertions = 'PASS: API results matched direct MongoDB reads for all four CRUD operations.';
} finally {
  if (userId) { const cleanup = await api('DELETE', `/users/${userId}`); assert.equal(cleanup.status, 204); evidence.cleanup = 'Temporary demonstration user and related records deleted.'; }
  if (cookie) await api('POST', '/auth/logout');
  await mongoose.disconnect();
}
await mkdir('submission', { recursive: true });
await writeFile('submission/mongodb-crud-evidence.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
