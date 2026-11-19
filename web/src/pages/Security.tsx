import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { Card, Kpi, Page, Table } from "../components/ui";

interface Overview {
  last24h: { logins: number; failed: number; lockouts: number; blocked: number; logouts: number };
  loginTrend: { hour: string; success: number; failed: number }[];
  suspiciousAccounts: { username: string; failures: number; last: string; ips: string[]; locked: boolean }[];
  risky: { at: string; action: string; actor: string; entityId: string; offHours: boolean }[];
}
interface Policies { roles: string[]; matrix: { permission: string; roles: string[] }[]; controls: { name: string; detail: string }[] }

export default function Security() {
  const ov = useApi<Overview>("/security/overview");
  const pol = useApi<Policies>("/security/policies");
  const k = ov.data?.last24h;
  return (
    <Page title="Security & governance" actions={<button className="btn" onClick={ov.reload}>Refresh</button>}>
      {ov.error && <p className="text-sm text-red-600">{ov.error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Successful logins (24h)" value={k?.logins ?? "…"} />
        <Kpi label="Failed logins (24h)" value={<span className={k && k.failed > 10 ? "text-red-600" : ""}>{k?.failed ?? "…"}</span>} />
        <Kpi label="Account lockouts (24h)" value={<span className={k?.lockouts ? "text-red-600" : ""}>{k?.lockouts ?? "…"}</span>} />
        <Kpi label="Blocked attempts (24h)" value={k?.blocked ?? "…"} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Login activity by hour (UTC)" className="h-72">
          <ResponsiveContainer height="85%"><BarChart data={ov.data?.loginTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
            <Bar dataKey="success" stackId="a" fill="#4f46e5" /><Bar dataKey="failed" stackId="a" fill="#ef4444" /></BarChart></ResponsiveContainer>
        </Card>
        <Card title="Suspicious accounts (last 15 min)">
          <Table rows={ov.data?.suspiciousAccounts} empty="No brute-force activity." cols={[["Username", (a) => a.username], ["Failures", (a) => a.failures], ["Source IPs", (a) => a.ips.join(", ")],
            ["State", (a) => a.locked ? <span className="text-red-600 font-semibold">LOCKED</span> : "watching"]]} />
        </Card>
      </div>
      <Card title="Risky events (7 days)">
        <Table rows={ov.data?.risky} empty="Nothing notable." cols={[["When", (r) => new Date(r.at).toLocaleString()], ["Event", (r) => <span className="font-mono text-xs">{r.action}{r.offHours && " (off-hours)"}</span>], ["Actor", (r) => r.actor], ["Target", (r) => <span className="font-mono text-xs">{r.entityId}</span>]]} />
      </Card>
      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Active controls"><ul className="text-sm space-y-2">{pol.data?.controls.map((c) => <li key={c.name}><div className="font-medium">{c.name}</div><div className="text-slate-500">{c.detail}</div></li>)}</ul></Card>
        <Card title="Access policy matrix" className="md:col-span-2">
          {pol.data && <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr><th className="text-left p-1">Permission</th>{pol.data.roles.map((r) => <th key={r} className="p-1 font-medium [writing-mode:vertical-rl] rotate-180 h-28 text-left">{r}</th>)}</tr></thead>
            <tbody>{pol.data.matrix.map((m) => <tr key={m.permission} className="border-t"><td className="p-1 font-mono">{m.permission}</td>{pol.data!.roles.map((r) => <td key={r} className="text-center">{m.roles.includes(r) ? <span className="text-emerald-600">●</span> : <span className="text-slate-200">·</span>}</td>)}</tr>)}</tbody></table></div>}
        </Card>
      </div>
    </Page>
  );
}
