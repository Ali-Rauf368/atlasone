import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Entry { _id: string; at: string; actor: { uid: string; name: string; roles: string[] }; action: string; entity: string; entityId: string; details?: unknown }

export default function Audit() {
  const [rows, setRows] = useState<Entry[]>([]); const [action, setAction] = useState(""); const [err, setErr] = useState("");
  const [integrity, setIntegrity] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  const verify = () => api<{ ok: boolean; checked: number; brokenAt?: number }>("/audit/verify").then(setIntegrity).catch((e) => setErr(e.message));
  useEffect(() => { api<Entry[]>(`/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`).then(setRows).catch((e) => setErr(e.message)); }, [action]);
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3"><h1 className="text-2xl font-bold">Audit log</h1>
        <button className="btn ml-auto" onClick={verify}>Verify integrity</button>
        <input className="input w-64" placeholder="Filter by action, e.g. PO_CREATED" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} /></div>
      {err && <p className="text-red-600">{err}</p>}
      {integrity && <p className={`text-sm font-medium ${integrity.ok ? "text-emerald-700" : "text-red-600"}`}>
        {integrity.ok ? `✓ Hash chain intact: ${integrity.checked} entries verified` : `✗ Tampering detected at entry #${integrity.brokenAt} (after ${integrity.checked} valid entries)`}</p>}
      <div className="card"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r._id} className="border-t align-top"><td className="py-2 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td><td>{r.actor.name}<div className="text-xs text-slate-400">{r.actor.roles.join(", ")}</div></td>
            <td className="font-mono">{r.action}</td><td>{r.entity}</td><td className="font-mono text-xs">{r.details ? JSON.stringify(r.details) : ""}</td></tr>))}</tbody></table></div>
    </div>
  );
}
