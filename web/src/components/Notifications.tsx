import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { Link } from "react-router-dom";
import { api, session } from "../lib/api";

interface Notice { id: string; title: string; body: string; link?: string; at: string; read?: boolean }

export default function Notifications() {
  const [items, setItems] = useState<Notice[]>([]); const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notice | null>(null); const [live, setLive] = useState(false);

  useEffect(() => {
    api<Notice[]>("/notifications").then(setItems).catch(() => {});
    const s = io({ auth: { token: session.get()?.token } });
    s.on("connect", () => setLive(true)); s.on("disconnect", () => setLive(false));
    s.on("notification", (n: Notice) => {
      setItems((x) => [{ ...n, read: false }, ...x].slice(0, 50)); setToast(n);
      setTimeout(() => setToast((t) => (t === n ? null : t)), 5000);
    });
    s.on("po:changed", () => window.dispatchEvent(new Event("atlas:refresh")));
    return () => { s.disconnect(); };
  }, []);

  const unread = items.filter((n) => !n.read).length;
  const toggle = () => {
    setOpen(!open);
    if (!open && unread) { api("/notifications/read-all", { method: "POST" }).catch(() => {}); setTimeout(() => setItems((x) => x.map((n) => ({ ...n, read: true }))), 1500); }
  };

  return (
    <div className="relative">
      <button className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-800 flex items-center gap-2" onClick={toggle}>
        <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`} title={live ? "Live" : "Offline"} />
        Notifications {unread > 0 && <span className="bg-red-500 text-white rounded-full px-1.5 text-xs">{unread}</span>}
      </button>
      {open && <div className="absolute left-full top-0 ml-2 w-80 card z-20 max-h-[28rem] overflow-auto">
        {items.length ? items.map((n) => <div key={n.id} className={`border-b last:border-0 py-2 text-sm ${n.read ? "" : "bg-indigo-50 -mx-2 px-2 rounded"}`}>
          <div className="font-medium">{n.link ? <Link to={n.link} onClick={() => setOpen(false)}>{n.title}</Link> : n.title}</div>
          <div className="text-slate-500">{n.body}</div><div className="text-xs text-slate-400">{new Date(n.at).toLocaleString()}</div></div>)
          : <p className="text-sm text-slate-400">No notifications yet</p>}</div>}
      {toast && <div className="fixed bottom-4 right-4 card z-30 w-80 border-l-4 border-l-indigo-600"><div className="font-medium text-sm">{toast.title}</div><div className="text-sm text-slate-500">{toast.body}</div></div>}
    </div>
  );
}
