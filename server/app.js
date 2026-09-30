import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { models, idFields, User, Station, Vehicle, Booking, Counter } from './models.js';
const active = ['Reserved','Charging'];
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const fields = { users:['name','membership'], stations:['name','address','supported_plug','current_status','user_id'], vehicles:['user_id','model_name','plug_type'], bookings:['user_id','station_id','vehicle_id','start_time','end_time','energy_used_kwh','total_bill','status'] };
const populate = { users:[], stations:['user_id'], vehicles:['user_id'], bookings:['user_id','station_id','vehicle_id'] };
async function reference(model, id, session) { if (!validId(id)) fail('Choose a valid related record.'); const doc = await model.findById(id).session(session); if (!doc) fail('The related record no longer exists.',404); return doc; }
async function mutate(fn) {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => {
    // Serialize related writes across clients so availability checks and cascading deletes remain atomic.
    await Counter.updateOne({ _id:'write-lock' }, { $inc: { value:1 } }, { session });
    result = await fn(session);
  }); return result; } finally { await session.endSession(); }
}
async function releaseStations(ids, session) {
  for (const id of [...new Set(ids.map(String))]) {
    if (!await Booking.exists({ station_id:id, status:{ $in:active } }).session(session))
      await Station.updateOne({ _id:id, current_status:'Occupied' }, { $set:{ current_status:'Available' } }, { session });
  }
}
async function validate(kind, data, old, session) {
  if (kind === 'stations' || kind === 'vehicles') await reference(User, data.user_id, session);
  if (old && kind === 'vehicles') {
    const busy = await Booking.exists({ vehicle_id:old._id,status:{$in:active} }).session(session);
    if (busy && (String(old.user_id)!==data.user_id || old.plug_type!==data.plug_type)) fail('Finish or cancel this vehicle’s active booking before changing its owner or plug.',409);
  }
  if (old && kind === 'stations') {
    const busy = await Booking.exists({ station_id:old._id,status:{$in:active} }).session(session);
    if (busy && (old.supported_plug!==data.supported_plug || data.current_status!=='Occupied')) fail('Finish or cancel the active booking before changing this station’s plug or availability.',409);
  }
  if (kind !== 'bookings') return;
  await reference(User,data.user_id,session);
  const vehicle = await reference(Vehicle,data.vehicle_id,session);
  const station = await reference(Station,data.station_id,session);
  if (String(vehicle.user_id)!==data.user_id) fail('This vehicle does not belong to the selected user.');
  const sameLegacy = old?.legacy_import && String(old.vehicle_id)===data.vehicle_id && String(old.station_id)===data.station_id && data.status==='Completed';
  if (vehicle.plug_type!==station.supported_plug && !sameLegacy) fail(`Plug mismatch: this vehicle needs ${vehicle.plug_type}; the station supports ${station.supported_plug}.`);
  if (!Number.isFinite(Date.parse(data.start_time)) || !Number.isFinite(Date.parse(data.end_time)) || Date.parse(data.end_time)<=Date.parse(data.start_time)) fail('End time must be later than start time.');
  for (const f of ['energy_used_kwh','total_bill']) if (typeof data[f]!=='number' || !Number.isFinite(data[f]) || data[f]<0) fail('Energy and bill must be non-negative numbers.');
  if (active.includes(data.status)) {
    if (station.current_status==='Maintenance') fail('This station is under maintenance.',409);
    const other = { _id:{$ne:old?._id}, status:{$in:active} };
    if (await Booking.exists({ ...other,station_id:data.station_id }).session(session)) fail('This station already has an active booking.',409);
    if (await Booking.exists({ ...other,vehicle_id:data.vehicle_id }).session(session)) fail('This vehicle already has an active booking.',409);
    const retains = old && active.includes(old.status) && String(old.station_id)===data.station_id;
    if (station.current_status==='Occupied' && !retains) fail('This station is currently occupied.',409);
  }
}
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'32kb'}));
  // The development admin app is same-origin and bound to localhost by default.
  app.use('/api', (req,res,next) => {
    const origin = req.get('origin');
    if (origin && !['GET','HEAD','OPTIONS'].includes(req.method)) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error:'Cross-origin writes are not allowed.' }); } catch { return res.status(403).json({ error:'Invalid origin.' }); }
    }
    next();
  });
  app.get('/api/health', (req,res) => res.json({ status:mongoose.connection.readyState===1?'connected':'disconnected',database:'MongoDB' }));
  app.get('/api/overview', async (req,res) => {
    const [users,stations,vehicles,bookings] = await Promise.all(Object.entries(models).map(async ([kind,model]) => model.find().populate(populate[kind]).sort({[idFields[kind]]:-1}).lean()));
    res.json({users,stations,vehicles,bookings});
  });
  app.get('/api/reports', async (req,res) => {
    const [billing,stationRevenue,availableStations,bookingDetails] = await Promise.all([
      User.aggregate([{$lookup:{from:'bookings',localField:'_id',foreignField:'user_id',as:'bookings'}},{$project:{name:1,membership:1,user_id:1,total_bookings:{$size:'$bookings'},total_energy_kwh:{$sum:'$bookings.energy_used_kwh'},total_spent:{$sum:'$bookings.total_bill'}}},{$sort:{total_spent:-1}}]),
      Booking.aggregate([{$group:{_id:'$station_id',total_revenue:{$sum:'$total_bill'},total_energy_kwh:{$sum:'$energy_used_kwh'},total_bookings:{$sum:1}}},{$lookup:{from:'stations',localField:'_id',foreignField:'_id',as:'station'}},{$unwind:'$station'},{$sort:{total_revenue:-1}}]),
      Station.find({current_status:'Available'}).lean(), Booking.find().populate(populate.bookings).lean()
    ]);
    res.json({billing,stationRevenue,availableStations,bookingDetails});
  });
  app.post('/api/actions/upgrade-members', async (req,res) => {
    const updated = await mutate(async session => {
      const ids = await Booking.aggregate([{$group:{_id:'$user_id',count:{$sum:1}}},{$match:{count:{$gte:2}}}]).session(session);
      return User.updateMany({_id:{$in:ids.map(x=>x._id)},membership:{$ne:'Premium'}},{$set:{membership:'Premium'}},{session});
    }); res.json({updated:updated.modifiedCount});
  });
  for (const [kind,model] of Object.entries(models)) {
    app.get(`/api/${kind}`, async (req,res) => res.json(await model.find().populate(populate[kind]).sort({[idFields[kind]]:-1})));
    app.get(`/api/${kind}/:id`, async (req,res) => { if(!validId(req.params.id)) fail('Invalid record ID.'); const row=await model.findById(req.params.id).populate(populate[kind]); if(!row) fail('Record not found.',404); res.json(row); });
    for (const method of ['post','put']) app[method](`/api/${kind}${method==='put'?'/:id':''}`, async (req,res) => {
      if (!req.body || Array.isArray(req.body)) fail('A record is required.');
      for (const key of Object.keys(req.body)) if (!fields[kind].includes(key)) fail(`Unknown field: ${key}`);
      const data = Object.fromEntries(fields[kind].filter(key=>req.body[key]!==undefined).map(key=>[key,req.body[key]]));
      const row = await mutate(async session => {
        const old = method==='put' ? await reference(model,req.params.id,session) : null;
        const values = {...(old?Object.fromEntries(fields[kind].map(key=>[key,old[key] instanceof mongoose.Types.ObjectId?String(old[key]):old[key]])):{}),...data};
        if(kind==='bookings') values.status ??= 'Reserved';
        if(kind==='stations') values.current_status ??= 'Available';
        await validate(kind,values,old,session);
        const oldStation=old && kind==='bookings'?String(old.station_id):null;
        const doc = old || new model();
        doc.set(values);
        if(!old) { const seq=await Counter.findOneAndUpdate({_id:kind},{$inc:{value:1}},{upsert:true,new:true,session}); doc[idFields[kind]]=seq.value; }
        await doc.save({session});
        if(kind==='bookings') {
          if(active.includes(doc.status)) await Station.updateOne({_id:doc.station_id},{$set:{current_status:'Occupied'}},{session});
          await releaseStations([...(oldStation?[oldStation]:[]),String(doc.station_id)],session);
        }
        return doc;
      });
      res.status(method==='post'?201:200).json(await model.findById(row._id).populate(populate[kind]));
    });
    app.get(`/api/${kind}/:id/delete-impact`, async(req,res) => {
      if(!validId(req.params.id)) fail('Invalid record ID.');
      const id=req.params.id;
      if(!await model.exists({_id:id})) fail('Record not found.',404);
      const vehicles=kind==='users'?await Vehicle.find({user_id:id}).distinct('_id'):[];
      const stations=kind==='users'?await Station.find({user_id:id}).distinct('_id'):[];
      const query=kind==='users'?{$or:[{user_id:id},{vehicle_id:{$in:vehicles}},{station_id:{$in:stations}}]}:kind==='bookings'?{_id:id}:{[idFields[kind]]:id};
      res.json({users:kind==='users'?1:0,vehicles:vehicles.length+(kind==='vehicles'?1:0),stations:stations.length+(kind==='stations'?1:0),bookings:await Booking.countDocuments(query)});
    });
    app.delete(`/api/${kind}/:id`, async(req,res) => {
      await mutate(async session => {
        const row=await reference(model,req.params.id,session);
        let query;
        if(kind==='users') {
          const vehicles=await Vehicle.find({user_id:row._id}).distinct('_id').session(session);
          const stations=await Station.find({user_id:row._id}).distinct('_id').session(session);
          query={$or:[{user_id:row._id},{vehicle_id:{$in:vehicles}},{station_id:{$in:stations}}]};
          await Vehicle.deleteMany({user_id:row._id},{session}); await Station.deleteMany({user_id:row._id},{session});
        } else query=kind==='bookings'?{_id:row._id}:{[idFields[kind]]:row._id};
        const affected=await Booking.find(query).distinct('station_id').session(session);
        await Booking.deleteMany(query,{session}); await model.deleteOne({_id:row._id},{session});
        await releaseStations(affected,session);
      }); res.status(204).end();
    });
  }
  app.use('/api', (req,res)=>res.status(404).json({error:'Endpoint not found.'}));
  if(existsSync(path.resolve('dist/index.html'))) { app.use(express.static('dist')); app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html'))); }
  app.use((err,req,res,next)=> { const validation=['ValidationError','CastError','StrictModeError'].includes(err.name); const status=err.status || (validation?400:err.code===11000?409:500); if(status===500) console.error(err); res.status(status).json({error:status===500?'Something went wrong. Please try again.':err.message}); });
  return app;
}
