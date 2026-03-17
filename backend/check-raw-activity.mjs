import mongoose from 'mongoose';
import Task from './src/models/Task.js';
import User from './src/models/User.js';
import Workspace from './src/models/Workspace.js';
import { hashPassword } from './src/utils/auth.js';

await mongoose.connect(process.env.MONGODB_CONNECTION_STRING);
const email = `activityraw${Date.now()}@local.test`;
const user = await User.create({ name: 'Raw User', email, password: hashPassword('123456'), isVerified: true });
const workspace = await Workspace.create({ user: user._id, name: 'Raw WS', normalizedName: 'raw ws' });
const t = await Task.create({ user: user._id, workspace: workspace._id, title: 'Raw Task' });

console.log('createdAt', t.createdAt, typeof t.createdAt);
const activityStartDate = new Date();
activityStartDate.setHours(0,0,0,0);
activityStartDate.setDate(activityStartDate.getDate()-13);
console.log('start', activityStartDate.toISOString());

const agg = await Task.aggregate([
  { $match: { user: user._id, createdAt: { $gte: activityStartDate } } },
  { $project: { createdAt: 1, status: 1 } },
]);
console.log('agg len', agg.length, agg[0]);

await mongoose.disconnect();
