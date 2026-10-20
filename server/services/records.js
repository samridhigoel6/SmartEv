import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { models, idFields, User, Station, Vehicle, Booking, Counter } from '../models/index.js';
import { AuthSession } from '../models/AuthSession.js';
import { mutate } from './transaction.js';
import { fail, validId } from '../middleware/errors.js';
export const active = ['Reserved', 'Charging'];
export const fields = {
  users: ['name', 'membership', 'phone'],
  stations: ['name', 'address', 'supported_plug', 'current_status', 'user_id', 'connector'],
  vehicles: ['user_id', 'model_name', 'plug_type', 'registrationNumber', 'batteryCapacity'],
  bookings: ['user_id', 'station_id', 'vehicle_id', 'start_time', 'end_time', 'energy_used_kwh', 'total_bill', 'status']
};
const populate = { users: [], stations: ['user_id'], vehicles: ['user_id'], bookings: ['user_id', 'station_id', 'vehicle_id'] };
export const scope = (kind, user) => user.role === 'admin' || kind === 'stations' ? {} : kind === 'users' ? { _id: user._id } : { user_id: user._id };
function clean(row, kind, user) {
  if (!row) return row;
  delete row.passwordHash;
  // Public station operators expose only a display name, never their account details.
  if (kind === 'stations' && row.user_id && user.role !== 'admin') row.user_id = { _id: row.user_id._id, name: row.user_id.name };
  if (kind === 'bookings' && row.station_id?.user_id) delete row.station_id.user_id;
  return row;
}
export async function list(kind, user, filters = {}) {
  const query = { ...scope(kind, user) };
  if (kind === 'stations') {
    const search = filters.search || filters.location;
    if (search !== undefined) {
      if (typeof search !== 'string' || search.length > 200) fail('Invalid station search.');
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: pattern }, { address: pattern }];
    }
    if (typeof filters.connectorType === 'string') query.supported_plug = filters.connectorType;
    if (typeof filters.status === 'string') query.current_status = filters.status;
  }
  return (await models[kind].find(query).populate(populate[kind]).sort({ [idFields[kind]]: -1 }).lean()).map(row => clean(row, kind, user));
}
export async function get(kind, id, user) {
  if (!validId(id)) fail('Invalid record ID.');
  const row = await models[kind].findOne({ $and: [{ _id: id }, scope(kind, user)] }).populate(populate[kind]).lean();
  if (!row) fail('Record not found.', 404);
  return clean(row, kind, user);
}
async function reference(model, id, session) {
  if (!validId(id)) fail('Choose a valid related record.');
  const row = await model.findById(id).session(session);
  if (!row) fail('The related record no longer exists.', 404);
  return row;
}
function authorize(kind, old, values, user) {
  if (user.role === 'admin') return;
  if (kind === 'stations') fail('Only administrators can manage stations.', 403);
  if (kind === 'users') {
    if (!old || String(old._id) !== String(user._id)) fail('Record not found.', 404);
    if (values.membership !== old.membership) fail('Only administrators can change memberships.', 403);
  } else {
    if (old && String(old.user_id) !== String(user._id)) fail('Record not found.', 404);
    if (String(values.user_id) !== String(user._id)) fail('You can only manage your own records.', 403);
  }
}
function interval(start, end) {
  if (!['string', 'object'].includes(typeof start) || !['string', 'object'].includes(typeof end) ||
      !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || new Date(end) <= new Date(start)) fail('End time must be later than start time.');
  return { start_time: { $lt: new Date(end) }, end_time: { $gt: new Date(start) } };
}
async function releaseStations(ids, session) {
  for (const id of [...new Set(ids.map(String))]) {
    if (!await Booking.exists({ station_id: id, status: { $in: active } }).session(session))
      await Station.updateOne({ _id: id, current_status: 'Occupied' }, { $set: { current_status: 'Available' } }, { session });
  }
}
async function validate(kind, data, old, session) {
  if (kind === 'stations' || kind === 'vehicles') await reference(User, data.user_id, session);
  if (old && kind === 'vehicles' && await Booking.exists({ vehicle_id: old._id, status: { $in: active } }).session(session)) {
    if (String(old.user_id) !== data.user_id || old.plug_type !== data.plug_type) fail('Finish or cancel this vehicle’s active bookings before changing its owner or plug.', 409);
  }
  if (old && kind === 'stations' && await Booking.exists({ station_id: old._id, status: { $in: active } }).session(session)) {
    if (old.supported_plug !== data.supported_plug || data.current_status !== 'Occupied') fail('Finish or cancel active bookings before changing this station’s plug or availability.', 409);
  }
  if (kind !== 'bookings') return {};
  const user = await reference(User, data.user_id, session);
  const vehicle = await reference(Vehicle, data.vehicle_id, session);
  const station = await reference(Station, data.station_id, session);
  if (String(vehicle.user_id) !== data.user_id) fail('This vehicle does not belong to the selected user.');
  const sameLegacy = old?.legacy_import && String(old.vehicle_id) === data.vehicle_id && String(old.station_id) === data.station_id && data.status === 'Completed';
  if (vehicle.plug_type !== station.supported_plug && !sameLegacy) fail(`Plug mismatch: this vehicle needs ${vehicle.plug_type}; the station supports ${station.supported_plug}.`);
  const overlap = interval(data.start_time, data.end_time);
  for (const field of ['energy_used_kwh', 'total_bill']) if (typeof data[field] !== 'number' || !Number.isFinite(data[field]) || data[field] < 0) fail('Energy and bill must be non-negative numbers.');
  if (old && ['Completed', 'Cancelled'].includes(old.status) && data.status !== old.status) fail('A completed or cancelled booking cannot be reopened.', 409);
  if (active.includes(data.status)) {
    if (station.current_status === 'Maintenance') fail('This station is under maintenance.', 409);
    const other = { _id: { $ne: old?._id }, status: { $in: active }, ...overlap };
    if (await Booking.exists({ ...other, station_id: data.station_id }).session(session)) fail('This connector is already booked during that time.', 409);
    if (await Booking.exists({ ...other, vehicle_id: data.vehicle_id }).session(session)) fail('This vehicle is already booked during that time.', 409);
    // Occupied without an active booking represents manual unavailability in the imported data.
    if (station.current_status === 'Occupied' && !await Booking.exists({ station_id: station._id, status: { $in: active } }).session(session)) fail('This station is currently occupied.', 409);
  }
  if (old?.status === 'Charging' && ['user_id', 'vehicle_id', 'station_id', 'start_time', 'end_time'].some(k => String(old[k]) !== String(k.endsWith('_time') ? new Date(data[k]) : data[k]))) fail('The connection and reserved time cannot change during charging.', 409);
  return { user, station };
}
function updateSession(doc, oldStatus) {
  if (doc.status === 'Charging' && oldStatus !== 'Charging') doc.charging_session = { startTime: new Date(), energyConsumed: doc.energy_used_kwh, totalCost: doc.total_bill, sessionStatus: 'Charging', simulated: true };
  if (doc.status === 'Completed') doc.charging_session = {
    startTime: doc.charging_session?.startTime || doc.start_time,
    endTime: oldStatus === 'Charging' ? new Date() : doc.charging_session?.endTime || doc.end_time,
    energyConsumed: doc.energy_used_kwh, totalCost: doc.total_bill, sessionStatus: 'Completed', simulated: true
  };
  if (doc.status === 'Cancelled' && doc.charging_session) { doc.charging_session.sessionStatus = 'Cancelled'; doc.charging_session.endTime = new Date(); }
}
export async function save(kind, id, body, actor) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A record is required.');
  for (const key of Object.keys(body)) if (!fields[kind].includes(key)) fail(`Unknown field: ${key}`);
  const result = await mutate(async session => {
    const old = id ? await reference(models[kind], id, session) : null;
    const previous = old ? Object.fromEntries(fields[kind].filter(k => old[k] !== undefined).map(k => [k, old[k] instanceof mongoose.Types.ObjectId ? String(old[k]) : old[k]])) : {};
    const data = { ...previous, ...body };
    if (kind === 'bookings') { data.status ??= 'Reserved'; data.energy_used_kwh ??= 0; data.total_bill ??= 0; }
    if (kind === 'stations') data.current_status ??= 'Available';
    if (kind === 'users') data.membership ??= 'Basic';
    authorize(kind, old, data, actor);
    if (old?.payment?.paymentStatus === 'Paid') fail('A paid booking is locked to preserve its receipt.', 409);
    const { station, user } = await validate(kind, data, old, session);
    const oldStation = old && kind === 'bookings' ? String(old.station_id) : null;
    const oldStatus = old?.status;
    const doc = old || new models[kind]();
    doc.set(data);
    if (!old) {
      const seq = await Counter.findOneAndUpdate({ _id: kind }, { $inc: { value: 1 } }, { upsert: true, new: true, session });
      doc[idFields[kind]] = seq.value;
    }
    if (kind === 'bookings') {
      if (!old) { doc.price_per_kwh = station.connector.pricePerKWh; doc.discount_percent = user.membership === 'Basic' ? 10 : 0; }
      if (actor.role !== 'admin' || body.total_bill === undefined) doc.total_bill = Math.round(doc.energy_used_kwh * doc.price_per_kwh * (1 - doc.discount_percent / 100) * 100) / 100;
      if (doc.status === 'Cancelled') { doc.total_bill = 0; doc.energy_used_kwh = 0; }
      updateSession(doc, oldStatus);
    }
    await doc.save({ session });
    if (kind === 'bookings') {
      if (active.includes(doc.status)) await Station.updateOne({ _id: doc.station_id }, { $set: { current_status: 'Occupied' } }, { session });
      await releaseStations([...(oldStation ? [oldStation] : []), String(doc.station_id)], session);
    }
    return doc._id;
  });
  return get(kind, String(result), actor);
}
async function deletionQuery(kind, id, session) {
  const vehicles = kind === 'users' ? await Vehicle.find({ user_id: id }).distinct('_id').session(session) : [];
  const stations = kind === 'users' ? await Station.find({ user_id: id }).distinct('_id').session(session) : [];
  const query = kind === 'users' ? { $or: [{ user_id: id }, { vehicle_id: { $in: vehicles } }, { station_id: { $in: stations } }] } : kind === 'bookings' ? { _id: id } : { [idFields[kind]]: id };
  return { query, vehicles, stations };
}
function allowDelete(kind, row, actor) {
  if (actor.role === 'admin') { if (kind === 'users' && String(row._id) === String(actor._id)) fail('You cannot delete your signed-in administrator account.', 409); return; }
  if (kind === 'users' || kind === 'stations') fail('Only administrators can delete these records.', 403);
  if (String(row.user_id?._id || row.user_id) !== String(actor._id)) fail('Record not found.', 404);
  if (kind === 'bookings' && ['Completed', 'Charging'].includes(row.status)) fail('Keep charging history; cancel an upcoming booking instead.', 409);
}
export async function deletionImpact(kind, id, actor) {
  const row = await get(kind, id, actor); allowDelete(kind, row, actor);
  const { query, vehicles, stations } = await deletionQuery(kind, id, null);
  return { users: kind === 'users' ? 1 : 0, vehicles: vehicles.length + (kind === 'vehicles' ? 1 : 0), stations: stations.length + (kind === 'stations' ? 1 : 0), bookings: await Booking.countDocuments(query) };
}
export async function remove(kind, id, actor) {
  await mutate(async session => {
    const row = await reference(models[kind], id, session); allowDelete(kind, row, actor);
    const { query } = await deletionQuery(kind, id, session);
    if (actor.role !== 'admin' && kind === 'vehicles' && await Booking.exists({ ...query, status: { $in: ['Charging', 'Completed'] } }).session(session)) fail('This vehicle has charging history and cannot be deleted.', 409);
    const affected = await Booking.find(query).distinct('station_id').session(session);
    await Booking.deleteMany(query, { session });
    if (kind === 'users') {
      await Vehicle.deleteMany({ user_id: id }, { session }); await Station.deleteMany({ user_id: id }, { session });
      await AuthSession.deleteMany({ userId: id }, { session });
    }
    await models[kind].deleteOne({ _id: id }, { session });
    await releaseStations(affected, session);
  });
}
export async function availability(id, start, end, exclude) {
  if (!validId(id) || (exclude && !validId(exclude))) fail('Invalid record ID.');
  const overlap = interval(start, end);
  const station = await Station.findById(id).lean();
  if (!station) fail('Station not found.', 404);
  const busy = await Booking.exists({ station_id: id, status: { $in: active }, ...overlap, ...(exclude ? { _id: { $ne: exclude } } : {}) });
  const manuallyOccupied = station.current_status === 'Occupied' && !await Booking.exists({ station_id: id, status: { $in: active } });
  return { available: station.current_status !== 'Maintenance' && !manuallyOccupied && !busy, connectorId: id, startTime: start, endTime: end };
}
export async function simulatePayment(id, body, actor) {
  if (!body || !['Paid', 'Failed'].includes(body.status) || Object.keys(body).some(k => k !== 'status')) fail('Choose Paid or Failed for the simulation.');
  await mutate(async session => {
    const row = await reference(Booking, id, session);
    if (actor.role !== 'admin' && String(row.user_id) !== String(actor._id)) fail('Record not found.', 404);
    if (row.status !== 'Completed') fail('Complete the charging session before simulating payment.', 409);
    if (row.payment?.paymentStatus === 'Paid') return; // Repeated clicks never create a second payment.
    row.payment = { amount: row.total_bill, paymentMethod: 'Simulation', paymentStatus: body.status, transactionDate: new Date(), transactionId: randomUUID(), simulated: true };
    await row.save({ session });
  });
  return get('bookings', id, actor);
}
