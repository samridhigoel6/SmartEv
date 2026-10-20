import mongoose from 'mongoose';
const { Schema } = mongoose;
export const plugs = ['CCS2', 'Type 2', 'CHAdeMO'];
export const memberships = ['Basic', 'Silver', 'Gold', 'Premium'];
const text = (max = 100) => ({ type: String, required: true, trim: true, maxlength: max });
const ref = model => ({ type: Schema.Types.ObjectId, ref: model, required: true });
const opts = { timestamps: true, versionKey: false, strict: 'throw' };
const user = new Schema({
  user_id: { type: Number, unique: true }, name: text(),
  membership: { type: String, enum: memberships, required: true, default: 'Basic' },
  email: { type: String, lowercase: true, trim: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, select: false }, phone: { type: String, trim: true, maxlength: 30, default: '' },
  role: { type: String, enum: ['admin', 'user'], default: 'user' }
}, opts);
// Imported profiles may have no login yet. Only real email strings participate in uniqueness.
user.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
const connector = new Schema({
  powerRating: { type: Number, min: 0.1, max: 1000, default: 50 },
  pricePerKWh: { type: Number, min: 0, max: 10000, default: 0.5 }
}, { _id: false, strict: 'throw' });
const station = new Schema({
  station_id: { type: Number, unique: true }, name: text(), address: text(500),
  supported_plug: { type: String, enum: plugs, required: true },
  current_status: { type: String, enum: ['Available', 'Occupied', 'Maintenance'], default: 'Available' },
  user_id: ref('User'), connector: { type: connector, default: () => ({}) }
}, opts);
station.index({ supported_plug: 1, current_status: 1 });
station.index({ user_id: 1 });
const vehicle = new Schema({
  vehicle_id: { type: Number, unique: true }, user_id: ref('User'), model_name: text(),
  plug_type: { type: String, enum: plugs, required: true },
  registrationNumber: { type: String, uppercase: true, trim: true, maxlength: 30 },
  batteryCapacity: { type: Number, min: 1, max: 1000 }
}, opts);
vehicle.index({ user_id: 1, createdAt: -1 });
vehicle.index({ registrationNumber: 1 }, { unique: true, partialFilterExpression: { registrationNumber: { $type: 'string' } } });
const chargingSession = new Schema({
  startTime: { type: Date, required: true }, endTime: Date,
  energyConsumed: { type: Number, min: 0, default: 0 }, totalCost: { type: Number, min: 0, default: 0 },
  sessionStatus: { type: String, enum: ['Charging', 'Completed', 'Cancelled'], required: true },
  simulated: { type: Boolean, default: true }
}, { _id: false, strict: 'throw' });
const payment = new Schema({
  amount: { type: Number, min: 0, required: true },
  paymentMethod: { type: String, enum: ['Simulation'], default: 'Simulation' },
  paymentStatus: { type: String, enum: ['Paid', 'Failed'], required: true },
  transactionDate: { type: Date, required: true }, transactionId: { type: String, required: true },
  simulated: { type: Boolean, default: true }
}, { _id: false, strict: 'throw' });
const booking = new Schema({
  booking_id: { type: Number, unique: true }, user_id: ref('User'), station_id: ref('Station'), vehicle_id: ref('Vehicle'),
  start_time: { type: Date, required: true }, end_time: { type: Date, required: true },
  energy_used_kwh: { type: Number, required: true, min: 0, max: 999999.99 }, total_bill: { type: Number, required: true, min: 0, max: 999999.99 },
  status: { type: String, enum: ['Reserved', 'Charging', 'Completed', 'Cancelled'], default: 'Reserved' },
  legacy_import: { type: Boolean, default: false },
  price_per_kwh: { type: Number, min: 0, default: 0.5 }, discount_percent: { type: Number, min: 0, max: 100, default: 0 },
  charging_session: chargingSession, payment
}, opts);
booking.index({ station_id: 1, status: 1, start_time: 1, end_time: 1 });
booking.index({ vehicle_id: 1, status: 1, start_time: 1, end_time: 1 });
booking.index({ user_id: 1, start_time: -1 });
booking.pre('validate', function () {
  if (this.start_time && this.end_time && this.end_time <= this.start_time) this.invalidate('end_time', 'End time must be later than start time.');
});
export const User = mongoose.model('User', user);
export const Station = mongoose.model('Station', station);
export const Vehicle = mongoose.model('Vehicle', vehicle);
export const Booking = mongoose.model('Booking', booking);
export const Counter = mongoose.model('Counter', new Schema({ _id: String, value: Number }));
export const models = { users: User, stations: Station, vehicles: Vehicle, bookings: Booking };
export const idFields = { users: 'user_id', stations: 'station_id', vehicles: 'vehicle_id', bookings: 'booking_id' };
