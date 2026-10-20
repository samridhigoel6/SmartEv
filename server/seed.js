import mongoose from 'mongoose';
import { User, Station, Vehicle, Booking, Counter, models } from './models.js';
export async function seedDatabase() {
  for (const model of [...Object.values(models), Counter]) await model.init();
  await Counter.updateOne({ _id: 'write-lock' }, { $setOnInsert: { value: 0 } }, { upsert: true });
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    await Counter.updateOne({ _id: 'write-lock' }, { $inc: { value: 1 } }, { session });
    if (await Counter.exists({ _id: 'seed-initialized' }).session(session)) return;
    if (await User.countDocuments().session(session)) return;
    const names = ['Alice Smith','Bob Johnson','Charlie Brown','Diana Prince','Ethan Hunt','Fiona Gallagher','George Clark','Hannah Abbott','Ian Malcolm','Julia Roberts'];
    const membership = ['Premium','Basic','Gold','Premium','Basic','Silver','Basic','Gold','Premium','Basic'];
    const users = await User.insertMany(names.map((name,i) => ({ user_id: i+1, name, membership: membership[i] })), { session });
    const stations = await Station.insertMany([
      ['Downtown FastCharge','123 Main St, Cityville','CCS2','Available'],['Metro EV Hub','456 Market St, Cityville','Type 2','Occupied'],
      ['Green Energy Station','789 Park Ave, Townsville','CHAdeMO','Available'],['EcoPower Slot A','101 Highway Rd, Suburbia','CCS2','Maintenance'],
      ['HyperCharge North','202 North Blvd, Metropolis','Type 2','Available'],['Southside Supercharge','303 South Rd, Metropolis','CCS2','Available'],
      ['Westend Charging Plaza','404 West Way, Cityville','CHAdeMO','Occupied'],['Central Park Plug','505 Central Ave, Townsville','Type 2','Available'],
      ['Airport EV Station','606 Airport Rd, Metropolis','CCS2','Available'],['TechPark Fast Charging','707 Tech Park, Suburbia','Type 2','Occupied']
    ].map(([name,address,supported_plug,current_status],i) => ({ station_id:i+1,name,address,supported_plug,current_status,user_id:users[i]._id })), { session });
    const vehicles = await Vehicle.insertMany([
      ['Tesla Model 3','CCS2'],['Nissan Leaf','CHAdeMO'],['Hyundai Kona EV','CCS2'],['BMW i4','Type 2'],['Chevrolet Bolt EV','CCS2'],['Audi e-tron','CCS2'],['Kia EV6','Type 2'],['Porsche Taycan','CCS2'],['MG ZS EV','Type 2'],['Tata Nexon EV','CCS2']
    ].map(([model_name,plug_type],i) => ({ vehicle_id:i+1,user_id:users[i]._id,model_name,plug_type })), { session });
    // Final state of the supplied SQL: booking 1 was deleted; original incompatible history is preserved.
    const rows = [[2,'01 10:00','01 11:00',20,9],[3,'02 12:00','02 13:15',42.1,21.05],[4,'02 14:30','02 16:00',50,25],[5,'03 09:00','03 09:45',18.25,8.22],[6,'03 11:15','03 13:00',60,30],[7,'04 15:00','04 16:30',30.4,13.68],[8,'04 17:00','04 18:30',45,22.5],[9,'05 07:30','05 08:45',28.6,14.3],[10,'05 19:00','05 20:30',38,17.1]];
    await Booking.insertMany(rows.map(([id,start,end,energy,bill]) => ({ booking_id:id,user_id:users[id-1]._id,station_id:stations[id-1]._id,vehicle_id:vehicles[id-1]._id,start_time:`2026-03-${start.replace(' ','T')}:00+05:30`,end_time:`2026-03-${end.replace(' ','T')}:00+05:30`,energy_used_kwh:energy,total_bill:bill,status:'Completed',legacy_import:true,charging_session:{startTime:`2026-03-${start.replace(' ','T')}:00+05:30`,endTime:`2026-03-${end.replace(' ','T')}:00+05:30`,energyConsumed:energy,totalCost:bill,sessionStatus:'Completed',simulated:true} })), { session });
    await Counter.create([{ _id: 'seed-initialized', value: 1 }], { session });
    for (const key of Object.keys(models)) await Counter.updateOne({ _id: key }, { $set: { value: 10 } }, { upsert: true, session });
  }); } finally { await session.endSession(); }
}
