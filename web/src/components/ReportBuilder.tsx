import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, session, usd } from "../lib/api";
import { Card } from "./ui";

const METRICS = { revenue: "Revenue", expenses: "Expenses", profit: "Profit", margin: "Margin", headcount: "Headcount", po_spend: "PO spend", pipeline: "Open pipeline", won_deals: "Won deals" };
interface Result { unit: string; total: number | null; rows: { group: string; value: number }[] }

export default function ReportBuilder() {
  const [q, setQ] = useState({ metric: "profit", groupBy: "country", from: "2026-01", to: "2026-12" });
  const [res, setRes] = useState<Result | null>(null); const [err, setErr] = useState("");
  const fmt = (v: number) => (res?.unit === "USD" ? usd(v) : res?.unit === "ratio" ? `${(v * 100).toFixed(1)}%` : v.toLocaleString());

  async function run() {
    try { setErr(""); setRes(await api<Result>("/reports/custom", { method: "POST", body: JSON.stringify(q) })); } catch (e) { setErr((e as Error).message); setRes(null); }
  }
  async function csv() {
    const r = await fetch("/api/reports/custom", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.get()?.token}` }, body: JSON.stringify({ ...q, format: "csv" }) });
    if (!r.ok) return setErr((await r.json()).error);
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = `atlasone_${q.metric}_by_${q.groupBy}.csv`; a.click();
  }
  return (
    <Card title="Custom report builder">
      <div className="flex flex-wrap gap-2 items-end mb-4 text-sm">
        <label className="text-xs text-slate-500">Metric<select className="input" value={q.metric} onChange={(e) => setQ({ ...q, metric: e.target.value })}>{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-slate-500">Group by<select className="input" value={q.groupBy} onChange={(e) => setQ({ ...q, groupBy: e.target.value })}>{["company", "country", "region", "period"].map((g) => <option key={g}>{g}</option>)}</select></label>
        <label className="text-xs text-slate-500">From<input className="input" type="month" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></label>
        <label className="text-xs text-slate-500">To<input className="input" type="month" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></label>
        <button className="btn" onClick={run}>Run</button><button className="btn bg-slate-600" onClick={csv}>CSV</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {res && (res.rows.length ? <div className="grid md:grid-cols-2 gap-4">
        <div className="h-64"><ResponsiveContainer><BarChart data={res.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="group" tick={{ fontSize: 11 }} /><YAxis tickFormatter={fmt} width={70} /><Tooltip formatter={(v: number) => fmt(v)} /><Bar dataKey="value" fill="#4f46e5" /></BarChart></ResponsiveContainer></div>
        <table className="text-sm w-full self-start"><tbody>{res.rows.map((r) => <tr key={r.group} className="border-t"><td className="py-1">{r.group}</td><td className="text-right">{fmt(r.value)}</td></tr>)}
          {res.total != null && <tr className="border-t font-semibold"><td className="py-1">Total</td><td className="text-right">{fmt(res.total)}</td></tr>}</tbody></table>
      </div> : <p className="text-sm text-slate-400">No data for this selection.</p>)}
    </Card>
  );
}
