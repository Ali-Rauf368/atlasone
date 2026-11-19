import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasRole, session, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Page, Table } from "../components/ui";
import ReportBuilder from "../components/ReportBuilder";

export default function Reports() {
  const user = session.get()?.user;
  const [from, setFrom] = useState("2026-01"); const [to, setTo] = useState("2026-12");
  const pnl = useApi<{ company: string; country: string; revenueUsd: number; expensesUsd: number; profitUsd: number }[]>(`/reports/pnl?from=${from}&to=${to}`);
  const budgets = useApi<{ company: string; budgetUsd: number; spentUsd: number; utilisation: number }[]>("/reports/budgets");
  const fc = useApi<{ history: { period: string; value: number }[]; forecast: { period: string; value: number }[] }>(hasRole(user, "GLOBAL_CEO", "SUPER_ADMIN") ? "/reports/forecast?months=3" : null);
  const chart = fc.data && [...fc.data.history.map((h) => ({ period: h.period, actual: h.value })),
    ...fc.data.forecast.map((f) => ({ period: f.period, forecast: f.value }))];
  async function exportCsv() {
    const res = await fetch(`/api/reports/pnl?from=${from}&to=${to}&format=csv`, { headers: { Authorization: `Bearer ${session.get()?.token}` } });
    const a = document.createElement("a"); a.href = URL.createObjectURL(await res.blob()); a.download = `pnl_${from}_${to}.csv`; a.click();
  }
  const totals = pnl.data?.reduce((a, r) => ({ rev: a.rev + r.revenueUsd, exp: a.exp + r.expensesUsd }), { rev: 0, exp: 0 });

  return (
    <Page title="Reports & forecast" actions={<div className="flex gap-2 items-center text-sm">
      <input type="month" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /> to
      <input type="month" className="input" value={to} onChange={(e) => setTo(e.target.value)} /><button className="btn whitespace-nowrap" onClick={exportCsv}>Export CSV</button></div>}>
      <ReportBuilder />
      <Card title={`Profit & loss (USD)${totals ? ` · net ${usd(totals.rev - totals.exp)}` : ""}`}>
        <Table rows={pnl.data} cols={[["Company", (r) => r.company], ["Country", (r) => r.country], ["Revenue", (r) => usd(r.revenueUsd)], ["Expenses", (r) => usd(r.expensesUsd)],
          ["Profit", (r) => <span className={r.profitUsd < 0 ? "text-red-600" : "text-emerald-700"}>{usd(r.profitUsd)}</span>]]} />
      </Card>
      {chart && <Card title="Revenue forecast (linear trend, next 3 months)" className="h-80">
        <ResponsiveContainer height="85%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis tickFormatter={usd} width={70} /><Tooltip formatter={(v: number) => usd(v)} /><Legend />
          <Line dataKey="actual" stroke="#4f46e5" /><Line dataKey="forecast" stroke="#f59e0b" strokeDasharray="5 5" /></LineChart></ResponsiveContainer>
      </Card>}
      <Card title="Budget utilisation 2026">
        <Table rows={budgets.data} cols={[["Company", (b) => b.company], ["Budget", (b) => usd(b.budgetUsd)], ["Committed", (b) => usd(b.spentUsd)],
          ["Utilisation", (b) => <div className="w-40 bg-slate-100 rounded h-2"><div className={`h-2 rounded ${b.utilisation > 0.9 ? "bg-red-500" : "bg-indigo-600"}`} style={{ width: `${Math.min(100, b.utilisation * 100)}%` }} /></div>]]} />
      </Card>
    </Page>
  );
}
