import mongoose from 'mongoose';
const { Schema } = mongoose;
export const plugs = ['CCS2', 'Type 2', 'CHAdeMO'];
export const memberships = ['Basic', 'Silver', 'Gold', 'Premium'];
const text = (max = 100) => ({ type: String, required: true, trim: true, maxlength: max });
const ref = model => ({ type: Schema.Types.ObjectId, ref: model, required: true });
const opts = { timestamps: true, versionKey: false, strict: 'throw' };
const user = new Schema({ user_id: { type: Number, unique: true }, name: text(), membership: { type: String, enum: memberships, required: true } }, opts);
const station = new Schema({ station_id: { type: Number, unique: true }, name: text(), address: text(500), supported_plug: { type: String, enum: plugs, required: true }, current_status: { type: String, enum: ['Available', 'Occupied', 'Maintenance'], default: 'Available' }, user_id: ref('User') }, opts);
const vehicle = new Schema({ vehicle_id: { type: Number, unique: true }, user_id: ref('User'), model_name: text(), plug_type: { type: String, enum: plugs, required: true } }, opts);
const booking = new Schema({
  booking_id: { type: Number, unique: true }, user_id: ref('User'), station_id: ref('Station'), vehicle_id: ref('Vehicle'),
  start_time: { type: Date, required: true }, end_time: { type: Date, required: true },
  energy_used_kwh: { type: Number, required: true, min: 0, max: 999999.99 }, total_bill: { type: Number, required: true, min: 0, max: 999999.99 },
  status: { type: String, enum: ['Reserved', 'Charging', 'Completed', 'Cancelled'], default: 'Reserved' },
  legacy_import: { type: Boolean, default: false }
}, opts);
booking.index({ station_id: 1, status: 1 });
booking.index({ vehicle_id: 1, status: 1 });
export const User = mongoose.model('User', user);
export const Station = mongoose.model('Station', station);
export const Vehicle = mongoose.model('Vehicle', vehicle);
export const Booking = mongoose.model('Booking', booking);
export const Counter = mongoose.model('Counter', new Schema({ _id: String, value: Number }));
export const models = { users: User, stations: Station, vehicles: Vehicle, bookings: Booking };
export const idFields = { users: 'user_id', stations: 'station_id', vehicles: 'vehicle_id', bookings: 'booking_id' };
