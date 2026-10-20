import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { connectDB, disconnectDB } from '../server/config/database.js';
import { seedDatabase } from '../server/seed.js';
import { migrateDatabase } from '../server/services/migrate.js';
import { provisionAdmin } from '../server/services/admin.js';
import { createApp } from '../server/app.js';
import { User, Station, Vehicle, Booking, Counter } from '../server/models/index.js';
import { AuthSession } from '../server/models/AuthSession.js';
const app = createApp();
const password = randomBytes(18).toString('base64url');
let admin, alice, bob, seeded, ownVehicle, otherVehicle, workingBooking;
function client(agent, auth) {
  return { agent, user: auth.user, csrf: auth.csrfToken,
    get: path => agent.get(`/api${path}`),
    post: (path, body = {}) => agent.post(`/api${path}`).set('X-CSRF-Token', auth.csrfToken).send(body),
    put: (path, body) => agent.put(`/api${path}`).set('X-CSRF-Token', auth.csrfToken).send(body),
    delete: path => agent.delete(`/api${path}`).set('X-CSRF-Token', auth.csrfToken)
  };
}
async function register(name, email) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ name, email, password }).expect(201);
  return client(agent, response.body);
}
const station = () => seeded.stations.find(s => s.station_id === 1);
const times = { start_time: '2030-10-10T10:00:00Z', end_time: '2030-10-10T11:00:00Z' };
const booking = (actor = alice, vehicle = ownVehicle, extra = {}) => ({ user_id: actor.user._id, vehicle_id: vehicle._id, station_id: station()._id, ...times, energy_used_kwh: 20, total_bill: 0, status: 'Reserved', ...extra });
before(async () => {
  await connectDB({ temporary: true }); await migrateDatabase({ copyLegacy: false }); await seedDatabase();
  await provisionAdmin({ email: 'admin@example.test', password });
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email: 'admin@example.test', password }).expect(200);
  admin = client(agent, response.body);
  seeded = (await admin.get('/overview').expect(200)).body;
  alice = await register('Private Driver A', 'driver-a@example.test');
  bob = await register('Private Driver B', 'driver-b@example.test');
  ownVehicle = (await alice.post('/vehicles', { user_id: alice.user._id, model_name: 'Driver A EV', plug_type: 'CCS2', registrationNumber: 'TEST-A', batteryCapacity: 40 }).expect(201)).body;
  otherVehicle = (await bob.post('/vehicles', { user_id: bob.user._id, model_name: 'Driver B EV', plug_type: 'CCS2', registrationNumber: 'TEST-B' }).expect(201)).body;
});
after(disconnectDB);
test('real replica-set database and existing source data are retained', async () => {
  assert.equal(mongoose.connection.name, 'smart_ev_charging_test');
  assert.ok((await mongoose.connection.db.admin().command({ hello: 1 })).setName);
  assert.equal(seeded.users.length, 11); assert.equal(seeded.stations.length, 10); assert.equal(seeded.vehicles.length, 10); assert.equal(seeded.bookings.length, 9);
  assert.equal(seeded.bookings.reduce((sum, b) => sum + b.total_bill, 0).toFixed(2), '160.85');
  assert.equal((await admin.get('/health')).body.database, 'MongoDB');
});
test('seed and migration are idempotent and preserve edited data', async () => {
  await seedDatabase(); await migrateDatabase({ copyLegacy: false });
  assert.equal(await Booking.countDocuments(), 9); assert.equal(await User.countDocuments(), 13);
});
test('bcrypt hashes passwords; cookies are HTTP-only and SameSite; production cookies are Secure', async () => {
  const stored = await User.findById(alice.user._id).select('+passwordHash');
  assert.notEqual(stored.passwordHash, password); assert.match(stored.passwordHash, /^\$2[ab]\$12\$/); assert.ok(await bcrypt.compare(password, stored.passwordHash));
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    const res = await request(app).post('/api/auth/login').send({ email: 'driver-a@example.test', password }).expect(200);
    assert.match(res.headers['set-cookie'][0], /HttpOnly/); assert.match(res.headers['set-cookie'][0], /SameSite=Strict/); assert.match(res.headers['set-cookie'][0], /Secure/);
    assert.equal(res.body.user.passwordHash, undefined);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('authentication, CSRF and origin checks protect writes', async () => {
  await request(app).get('/api/overview').expect(401);
  await alice.agent.post('/api/vehicles').send({}).expect(403);
  await alice.post('/vehicles', {}).set('Origin', 'https://attacker.example').expect(403);
  await request(app).post('/api/auth/login').send({ email: 'driver-a@example.test', password: 'incorrect-password' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: { $ne: null }, password }).expect(400);
  await request(app).post('/api/auth/register').send({ name: 'Escalated', email: 'e@example.test', password, role: 'admin' }).expect(400);
  await request(app).post('/api/auth/register').send({ name: 'Duplicate', email: 'DRIVER-A@example.test', password }).expect(409);
});
test('private data is scoped on overview, reports, lists and detail routes', async () => {
  const own = (await alice.get('/overview').expect(200)).body;
  assert.deepEqual(own.users.map(u => u._id), [alice.user._id]); assert.equal(own.vehicles.length, 1); assert.equal(own.bookings.length, 0);
  assert.equal(own.stations.length, 10); assert.equal(own.stations[0].user_id.email, undefined);
  await alice.get(`/users/${bob.user._id}`).expect(404); await alice.get(`/vehicles/${otherVehicle._id}`).expect(404);
  assert.equal((await alice.get('/reports')).body.billing.length, 1);
  assert.equal((await alice.get('/users')).body[0].passwordHash, undefined);
});
test('users cannot change another owner, memberships, stations or roles', async () => {
  await alice.put(`/vehicles/${otherVehicle._id}`, { model_name: 'Taken' }).expect(404);
  await alice.delete(`/vehicles/${otherVehicle._id}`).expect(404);
  await alice.post('/vehicles', { user_id: bob.user._id, model_name: 'Invalid', plug_type: 'CCS2' }).expect(403);
  await alice.put(`/users/${alice.user._id}`, { membership: 'Premium' }).expect(403);
  await alice.put(`/users/${alice.user._id}`, { role: 'admin' }).expect(400);
  await alice.post('/stations', { user_id: alice.user._id, name: 'Not allowed', address: 'Street', supported_plug: 'CCS2' }).expect(403);
  await alice.post('/actions/upgrade-members').expect(403);
});
test('station search, filters, details and embedded connector read work', async () => {
  const rows = (await alice.get('/stations?location=Cityville&connectorType=CCS2').expect(200)).body;
  assert.ok(rows.length); assert.ok(rows.every(s => s.address.includes('Cityville') && s.supported_plug === 'CCS2'));
  assert.equal((await alice.get(`/stations/${station()._id}/connectors`)).body[0].pricePerKWh, 0.5);
  assert.equal((await alice.get('/stations?search=%24ne')).body.length, 0);
});
test('booking validates owner, connectors, dates and nonnegative energy', async () => {
  await alice.post('/bookings', booking(alice, otherVehicle)).expect(400);
  await alice.post('/bookings', booking(alice, ownVehicle, { station_id: seeded.stations.find(s => s.station_id === 3)._id })).expect(400);
  await alice.post('/bookings', booking(alice, ownVehicle, { end_time: times.start_time })).expect(400);
  await alice.post('/bookings', booking(alice, ownVehicle, { energy_used_kwh: -1 })).expect(400);
  assert.equal(await Booking.countDocuments(), 9);
});
test('create persists to MongoDB and calculates the bill server-side', async () => {
  workingBooking = (await alice.post('/bookings', booking(alice, ownVehicle, { total_bill: 1 })).expect(201)).body;
  assert.equal(workingBooking.total_bill, 9); assert.equal(workingBooking.discount_percent, 10);
  assert.equal((await Booking.findById(workingBooking._id)).total_bill, 9);
  assert.equal((await alice.get(`/stations/${station()._id}`)).body.current_status, 'Occupied');
  const query = new URLSearchParams({ startTime: times.start_time, endTime: times.end_time });
  assert.equal((await bob.get(`/stations/${station()._id}/availability?${query}`)).body.available, false);
  await bob.get(`/bookings/${workingBooking._id}`).expect(404); await bob.post(`/bookings/${workingBooking._id}/cancel`).expect(404);
});
test('overlaps fail; adjacent reservations on the same connector succeed', async () => {
  await bob.post('/bookings', booking(bob, otherVehicle)).expect(409);
  const adjacent = (await bob.post('/bookings', booking(bob, otherVehicle, { start_time: times.end_time, end_time: '2030-10-10T12:00:00Z' })).expect(201)).body;
  await bob.post(`/bookings/${adjacent._id}/cancel`).expect(200);
  assert.equal((await Booking.findById(adjacent._id)).status, 'Cancelled');
  assert.equal((await alice.get(`/stations/${station()._id}`)).body.current_status, 'Occupied');
});
test('active station/vehicle edits cannot invalidate reservations', async () => {
  await admin.put(`/stations/${station()._id}`, { current_status: 'Maintenance' }).expect(409);
  await alice.put(`/vehicles/${ownVehicle._id}`, { plug_type: 'Type 2' }).expect(409);
});
test('moving a reservation releases its old connector', async () => {
  const target = seeded.stations.find(s => s.station_id === 6);
  await alice.put(`/bookings/${workingBooking._id}`, { station_id: target._id }).expect(200);
  assert.equal((await alice.get(`/stations/${station()._id}`)).body.current_status, 'Available');
  assert.equal((await alice.get(`/stations/${target._id}`)).body.current_status, 'Occupied');
});
test('simulated start/end persist session history and calculate final cost', async () => {
  await alice.post(`/bookings/${workingBooking._id}/start`).expect(200);
  assert.equal((await Booking.findById(workingBooking._id)).charging_session.sessionStatus, 'Charging');
  const completed = (await alice.post(`/bookings/${workingBooking._id}/end`, { energy_used_kwh: 30 }).expect(200)).body;
  assert.equal(completed.total_bill, 13.5); assert.equal(completed.charging_session.energyConsumed, 30); assert.equal(completed.charging_session.simulated, true);
  assert.equal(completed.station_id.current_status, 'Available');
  assert.equal((await alice.get('/charging-sessions')).body.length, 1);
  assert.equal((await bob.get('/charging-sessions')).body.length, 0);
  await alice.put(`/bookings/${workingBooking._id}`, { status: 'Reserved' }).expect(409);
});
test('payment simulation is owned, calculated, persistent and idempotent', async () => {
  await bob.post(`/bookings/${workingBooking._id}/payment`, { status: 'Paid' }).expect(404);
  await alice.post(`/bookings/${workingBooking._id}/payment`, { status: 'Paid', amount: 0 }).expect(400);
  await alice.post(`/bookings/${workingBooking._id}/payment`, { status: 'Failed' }).expect(200);
  const paid = (await alice.post(`/bookings/${workingBooking._id}/payment`, { status: 'Paid' }).expect(200)).body;
  const again = (await alice.post(`/bookings/${workingBooking._id}/payment`, { status: 'Paid' }).expect(200)).body;
  assert.equal(paid.payment.amount, 13.5); assert.equal(paid.payment.simulated, true); assert.equal(paid.payment.transactionId, again.payment.transactionId);
  assert.equal((await alice.get('/payments')).body.length, 1); assert.equal((await bob.get('/payments')).body.length, 0);
  await alice.put(`/bookings/${workingBooking._id}`, { total_bill: 0 }).expect(409);
});
test('concurrent users cannot reserve the same overlapping interval', async () => {
  const next = { start_time: '2031-01-01T10:00:00Z', end_time: '2031-01-01T11:00:00Z' };
  const responses = await Promise.all([alice.post('/bookings', booking(alice, ownVehicle, next)), bob.post('/bookings', booking(bob, otherVehicle, next))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const winner = responses[0].status === 201 ? alice : bob;
  const row = responses.find(r => r.status === 201).body;
  await winner.post(`/bookings/${row._id}/cancel`).expect(200);
  assert.equal((await Booking.findById(row._id)).status, 'Cancelled');
});
test('CRUD, indexes, delete impact and cascading transactions work', async () => {
  const u = (await admin.post('/users', { name: 'Cascade Driver', membership: 'Gold' }).expect(201)).body;
  const v = (await admin.post('/vehicles', { user_id: u._id, model_name: 'Cascade EV', plug_type: 'CCS2', registrationNumber: 'CASCADE' }).expect(201)).body;
  await admin.post('/vehicles', { user_id: u._id, model_name: 'Duplicate', plug_type: 'CCS2', registrationNumber: 'CASCADE' }).expect(409);
  const s = (await admin.post('/stations', { user_id: u._id, name: 'Cascade Station', address: 'Test Road', supported_plug: 'CCS2', connector: { powerRating: 60, pricePerKWh: 2 } }).expect(201)).body;
  await admin.put(`/users/${u._id}`, { name: 'Updated Driver' }).expect(200);
  await admin.put(`/vehicles/${v._id}`, { model_name: 'Updated EV' }).expect(200);
  await admin.put(`/stations/${s._id}`, { address: 'Updated Road' }).expect(200);
  const b = (await admin.post('/bookings', { ...booking(), user_id: u._id, station_id: s._id, vehicle_id: v._id }).expect(201)).body;
  assert.deepEqual((await admin.get(`/users/${u._id}/delete-impact`)).body, { users: 1, stations: 1, vehicles: 1, bookings: 1 });
  await admin.delete(`/users/${u._id}`).expect(204);
  assert.equal(await Vehicle.findById(v._id), null); assert.equal(await Station.findById(s._id), null); assert.equal(await Booking.findById(b._id), null);
});
test('aggregation reports are scoped and membership upgrade is idempotent', async () => {
  const own = (await alice.get('/reports')).body;
  assert.equal(own.billing.length, 1); assert.equal(own.billing[0].total_spent, 13.5);
  await admin.post('/actions/upgrade-members').expect(200);
  assert.equal((await admin.post('/actions/upgrade-members')).body.updated, 0);
});
test('logout invalidates the server session and profile endpoint survives fresh requests', async () => {
  const me = await alice.get('/auth/me').expect(200); assert.equal(me.body.user._id, alice.user._id);
  await bob.post('/auth/logout').expect(204); await bob.get('/auth/me').expect(401);
  await AuthSession.updateMany({ userId: alice.user._id }, { $set: { expiresAt: new Date(0) } });
  await alice.get('/overview').expect(401);
});
