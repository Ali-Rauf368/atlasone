import { useEffect, useState } from "react";
import Anomalies from "../components/Anomalies";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, usd } from "../lib/api";

interface Co { id: string; code: string; name: string; country: string; region: string; employees: number; revenue: number; expenses: number; profit: number; margin: number }
interface Data { kpis: { revenue: number; subsidiaries: number; employees: number; countries: number; pendingApprovals: number }; byCompany: Co[]; underperforming: Co[]; trend: { period: string; revenue: number; expenses: number }[] }

export default function Dashboard() {
  const [d, setD] = useState<Data>(); const [err, setErr] = useState(""); const [country, setCountry] = useState("ALL");
  useEffect(() => { api<Data>("/dashboard/global").then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-red-600">{err}</p>;
  if (!d) return <p>Loading…</p>;
  const rows = d.byCompany.filter((c) => c.revenue > 0 && (country === "ALL" || c.country === country));
  const kpis = [["Global revenue (YTD)", usd(d.kpis.revenue)], ["Subsidiaries", d.kpis.subsidiaries], ["Employees", d.kpis.employees.toLocaleString()], ["Countries", d.kpis.countries], ["Pending approvals", d.kpis.pendingApprovals]];
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Global CEO dashboard</h1>
        <select className="input w-56" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="ALL">All countries</option>
          {[...new Set(d.byCompany.map((c) => c.country))].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {kpis.map(([k, v]) => <div key={k} className="card"><div className="text-xs text-slate-500">{k}</div><div className="text-2xl font-semibold mt-1">{v}</div></div>)}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card h-80"><h2 className="font-semibold mb-2">Subsidiary comparison (USD)</h2>
          <ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="code" /><YAxis tickFormatter={usd} width={70} /><Tooltip formatter={(v: number) => usd(v)} /><Legend />
            <Bar dataKey="revenue" fill="#4f46e5" /><Bar dataKey="expenses" fill="#94a3b8" /></BarChart></ResponsiveContainer></div>
        <div className="card h-80"><h2 className="font-semibold mb-2">Global monthly trend (USD)</h2>
          <ResponsiveContainer><LineChart data={d.trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis tickFormatter={usd} width={70} /><Tooltip formatter={(v: number) => usd(v)} /><Legend />
            <Line dataKey="revenue" stroke="#4f46e5" /><Line dataKey="expenses" stroke="#94a3b8" /></LineChart></ResponsiveContainer></div>
      </div>
      <Anomalies />
      <div className="card">
        <h2 className="font-semibold mb-3">Business units</h2>
        <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Company</th><th>Country</th><th>Employees</th><th>Revenue</th><th>Expenses</th><th>Margin</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className="border-t"><td className="py-2">{c.name}</td><td>{c.country}</td><td>{c.employees}</td><td>{usd(c.revenue)}</td><td>{usd(c.expenses)}</td>
              <td className={c.margin < 0.1 ? "text-red-600 font-semibold" : "text-emerald-600"}>{(c.margin * 100).toFixed(1)}%{c.margin < 0.1 && " ⚠ underperforming"}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}
