import { User, Station, Booking } from '../models/index.js';
import { list, scope } from './records.js';
import { mutate } from './transaction.js';
export async function overview(user) {
  const [users, stations, vehicles, bookings] = await Promise.all(['users', 'stations', 'vehicles', 'bookings'].map(kind => list(kind, user)));
  return { users, stations, vehicles, bookings };
}
export async function reports(user) {
  const [billing, stationRevenue, availableStations, bookingDetails] = await Promise.all([
    User.aggregate([
      { $match: scope('users', user) },
      { $lookup: { from: 'bookings', localField: '_id', foreignField: 'user_id', as: 'bookings' } },
      { $project: { name: 1, membership: 1, user_id: 1, total_bookings: { $size: '$bookings' }, total_energy_kwh: { $sum: '$bookings.energy_used_kwh' }, total_spent: { $sum: '$bookings.total_bill' } } },
      { $sort: { total_spent: -1 } }
    ]),
    Booking.aggregate([
      { $match: scope('bookings', user) },
      { $group: { _id: '$station_id', total_revenue: { $sum: '$total_bill' }, total_energy_kwh: { $sum: '$energy_used_kwh' }, total_bookings: { $sum: 1 } } },
      { $lookup: { from: 'stations', localField: '_id', foreignField: '_id', as: 'station' } }, { $unwind: '$station' },
      { $project: { total_revenue: 1, total_energy_kwh: 1, total_bookings: 1, 'station.name': 1, 'station._id': 1 } },
      { $sort: { total_revenue: -1 } }
    ]),
    Station.find({ current_status: 'Available' }).select('name address supported_plug station_id connector current_status').lean(), list('bookings', user)
  ]);
  return { billing, stationRevenue, availableStations, bookingDetails };
}
export async function upgradeMembers() {
  return mutate(async session => {
    const ids = await Booking.aggregate([{ $match: { status: { $ne: 'Cancelled' } } }, { $group: { _id: '$user_id', count: { $sum: 1 } } }, { $match: { count: { $gte: 2 } } }]).session(session);
    const result = await User.updateMany({ _id: { $in: ids.map(x => x._id) }, membership: { $ne: 'Premium' } }, { $set: { membership: 'Premium' } }, { session });
    return { updated: result.modifiedCount };
  });
}
