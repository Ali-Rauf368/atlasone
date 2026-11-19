import mongoose from "mongoose";
import { emitToRole, emitToUser } from "./realtime.js";

/** Persistent notifications (MongoDB) + live push (Socket.IO). Users who are offline see them on next login. */
const NotificationSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  uid: { type: String, index: true },
  role: { type: String, index: true },
  title: String, body: String, link: String,
  readBy: { type: [String], default: [] },
});
export const Notification = mongoose.model("Notification", NotificationSchema);

export interface Notice { title: string; body: string; link?: string }

export async function notifyRole(role: string, n: Notice) {
  const doc = await Notification.create({ ...n, role });
  emitToRole(role, { ...n, id: doc.id, at: doc.at });
}
export async function notifyUser(uid: string, n: Notice) {
  const doc = await Notification.create({ ...n, uid });
  emitToUser(uid, { ...n, id: doc.id, at: doc.at });
}
export const inboxFilter = (uid: string, roles: string[]) => ({ $or: [{ uid }, { role: { $in: roles } }] });
