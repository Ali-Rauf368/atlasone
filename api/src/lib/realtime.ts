import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "../middleware/auth.js";
import { env } from "./env.js";
import type { LdapUser } from "./ldap.js";

let io: Server | null = null;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.corsOrigin } });
  io.use(async (socket, next) => {
    const user = await verifyToken(String(socket.handshake.auth.token ?? ""));
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user; next();
  });
  io.on("connection", (socket) => {
    const u = socket.data.user as LdapUser;
    socket.join(`user:${u.uid}`);
    u.roles.forEach((r) => socket.join(`role:${r}`));
  });
}

// Low-level emitters; use lib/notify.ts, which also persists notifications.
export const emitToRole = (role: string, payload: unknown) => io?.to(`role:${role}`).emit("notification", payload);
export const emitToUser = (uid: string, payload: unknown) => io?.to(`user:${uid}`).emit("notification", payload);
export const broadcast = (event: string, payload: unknown) => io?.emit(event, payload);
