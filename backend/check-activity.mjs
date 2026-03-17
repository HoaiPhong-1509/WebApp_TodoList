import mongoose from 'mongoose';
import User from './src/models/User.js';
import { hashPassword, createAuthToken } from './src/utils/auth.js';

await mongoose.connect(process.env.MONGODB_CONNECTION_STRING);

const email = `activity${Date.now()}@local.test`;
const user = await User.create({
  name: 'Activity User',
  email,
  password: hashPassword('123456'),
  isVerified: true,
});

const secret = process.env.JWT_SECRET ? process.env.JWT_SECRET : 'dev_secret_change_me';
const token = createAuthToken({ userId: user._id.toString(), email: user.email }, secret);
const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
};

let r = await fetch('http://localhost:5012/api/workspaces', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'Activity WS' }),
});
const wsData = await r.json();
const ws = wsData.workspace;
console.log('workspace', r.status, ws?._id);

r = await fetch('http://localhost:5012/api/tasks', {
  method: 'POST',
  headers,
  body: JSON.stringify({ title: 'Task A', workspaceId: ws._id }),
});
const t1 = await r.json();
console.log('create1', r.status, t1._id);

r = await fetch('http://localhost:5012/api/tasks', {
  method: 'POST',
  headers,
  body: JSON.stringify({ title: 'Task B', workspaceId: ws._id }),
});
const t2 = await r.json();
console.log('create2', r.status, t2._id);

r = await fetch(`http://localhost:5012/api/tasks/${t1._id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ status: 'completed', workspaceId: ws._id }),
});
console.log('to completed', r.status);

r = await fetch(`http://localhost:5012/api/tasks?filter=all&workspaceId=${ws._id}`, {
  headers: { authorization: `Bearer ${token}` },
});
const data = await r.json();

const createdTotal = (data.userActivitySeries || []).reduce((sum, item) => sum + (item.createdCount || 0), 0);
const completedTotal = (data.userActivitySeries || []).reduce((sum, item) => sum + (item.completedCount || 0), 0);

console.log('get', r.status, 'workspaceCounts', data.todoCount, data.inProgressCount, data.completedCount);
console.log('activityTotals', createdTotal, completedTotal);
console.log('latestPoint', data.userActivitySeries?.[data.userActivitySeries.length - 1]);

await mongoose.disconnect();
