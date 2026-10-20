import 'dotenv/config';
import mongoose from 'mongoose';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
let localMongo;
let temporaryDatabase = false;
const binary = { version: '7.0.14', downloadDir: path.resolve('.data/binaries') };
export async function connectDB({ temporary = false } = {}) {
  temporaryDatabase = temporary;
  let uri = process.env.MONGODB_URI;
  if (!temporary && process.env.NODE_ENV === 'production' && !uri) throw new Error('Set MONGODB_URI to a replica set or Atlas database in production.');
  if (temporary) {
    localMongo = await MongoMemoryReplSet.create({ binary, replSet: { count: 1, storageEngine: 'wiredTiger', name: 'smart-ev-test' } });
    uri = localMongo.getUri();
  } else if (!uri) {
    const dbPath = path.resolve('.data/mongodb');
    await mkdir(dbPath, { recursive: true });
    localMongo = await MongoMemoryServer.create({ binary, instance: { dbPath, storageEngine: 'wiredTiger', replSet: 'smart-ev', ip: '127.0.0.1' } });
    uri = localMongo.getUri();
    // Reuse the persisted replica set even when the OS selects a new port on restart.
    const adminClient = await mongoose.mongo.MongoClient.connect(uri, { directConnection: true });
    try {
      const admin = adminClient.db('admin');
      const host = `127.0.0.1:${localMongo.instanceInfo.port}`;
      try {
        const { config } = await admin.command({ replSetGetConfig: 1 });
        if (config.members[0].host !== host) {
          config.members[0].host = host;
          config.version += 1;
          await admin.command({ replSetReconfig: config, force: true });
        }
      } catch (error) {
        if (error.code !== 94) throw error;
        await admin.command({ replSetInitiate: { _id: 'smart-ev', members: [{ _id: 0, host }] } });
      }
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if ((await admin.command({ hello: 1 })).isWritablePrimary) { ready = true; break; }
        await pause(200);
      }
      if (!ready) throw new Error('Local MongoDB did not become ready within 30 seconds.');
    } finally { await adminClient.close(); }
  }
  await mongoose.connect(uri, { dbName: temporary ? 'smart_ev_charging_test' : (process.env.MONGODB_DB || 'smart_ev_charging'), serverSelectionTimeoutMS: 10000 });
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') { await mongoose.disconnect(); throw new Error('MongoDB transactions require a replica set or Atlas cluster. Standalone MongoDB is not supported.'); }
  console.log(`MongoDB connected (${temporary ? 'test' : process.env.MONGODB_URI ? 'configured database' : 'local, persistent storage'})`);
}
export async function disconnectDB() { await mongoose.disconnect(); if (localMongo) await localMongo.stop({ doCleanup: temporaryDatabase }); }
