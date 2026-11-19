import { useState } from "react";
import { api, hasRole, session, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Page, Table } from "../components/ui";

interface Fx { currency: string; toUsd: number; updated: string }
interface Entry { id: string; period: string; type: string; category: string; amount: number; currency: string; amountUsd: number; source: string; company: { name: string } }
interface Budget { companyId: string; company: string; year: number; budgetUsd: number; spentUsd: number; utilisation: number }
interface Company { id: string; name: string; currency: string }

export default function Finance() {
  const canManage = hasRole(session.get()?.user, "FINANCE", "SUPER_ADMIN");
  const fx = useApi<Fx[]>("/finance/fx");
  const [filter, setFilter] = useState({ companyId: "", source: "" });
  const entries = useApi<Entry[]>(`/finance/entries?companyId=${filter.companyId}&source=${filter.source}`);
  const budgets = useApi<Budget[]>("/reports/budgets");
  const companies = useApi<Company[]>("/dashboard/companies");
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [je, setJe] = useState({ companyId: "", period: new Date().toISOString().slice(0, 7), type: "EXPENSE", category: "", amount: "" });
  const fail = (e: unknown) => setMsg({ t: (e as Error).message, ok: false });

  async function setRate(cur: string, old: number) {
    const v = prompt(`New rate: 1 ${cur} = ? USD`, String(old)); if (!v) return;
    try { await api(`/finance/fx/${cur}`, { method: "PUT", body: JSON.stringify({ toUsd: Number(v) }) }); }
    catch (e) {
      if (!(e as Error).message.includes("confirm=true") || !confirm(`${(e as Error).message}\n\nApply anyway?`)) return fail(e);
      try { await api(`/finance/fx/${cur}?confirm=true`, { method: "PUT", body: JSON.stringify({ toUsd: Number(v) }) }); } catch (e2) { return fail(e2); }
    }
    fx.reload(); setMsg({ t: `${cur} rate updated (applies to new postings)`, ok: true });
  }
  async function setBudget(b: Budget) {
    const v = prompt(`${b.year} budget for ${b.company} (USD)`, String(b.budgetUsd)); if (!v) return;
    try { await api(`/finance/budgets/${b.companyId}/${b.year}`, { method: "PUT", body: JSON.stringify({ amountUsd: Number(v) }) }); budgets.reload(); setMsg({ t: "Budget updated", ok: true }); } catch (e) { fail(e); }
  }
  async function post(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/finance/entries", { method: "POST", body: JSON.stringify({ ...je, amount: Number(je.amount) }) }); entries.reload(); setMsg({ t: "Journal entry posted", ok: true }); setJe({ ...je, category: "", amount: "" }); } catch (e) { fail(e); }
  }
  const cur = companies.data?.find((c) => c.id === je.companyId)?.currency;

  return (
    <Page title="Global finance">
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</p>}
      <div className="grid md:grid-cols-3 gap-4">
        <Card title="FX rates → USD">
          <Table rows={fx.data} cols={[["Currency", (r) => <span className="font-mono">{r.currency}</span>], ["1 unit = USD", (r) => r.toUsd.toPrecision(4)], ["Updated", (r) => new Date(r.updated).toLocaleDateString()],
            ["", (r) => canManage && r.currency !== "USD" && <button className="text-indigo-700 text-sm" onClick={() => setRate(r.currency, r.toUsd)}>Set</button>]]} />
        </Card>
        <Card title="Budgets & utilisation" className="md:col-span-2">
          <Table rows={budgets.data} cols={[["Company", (b) => b.company], ["Year", (b) => b.year], ["Budget", (b) => usd(b.budgetUsd)], ["Committed", (b) => usd(b.spentUsd)],
            ["Used", (b) => <div className="flex items-center gap-2"><div className="w-28 bg-slate-100 rounded h-2"><div className={`h-2 rounded ${b.utilisation > 0.9 ? "bg-red-500" : "bg-indigo-600"}`} style={{ width: `${Math.min(100, b.utilisation * 100)}%` }} /></div>{(b.utilisation * 100).toFixed(0)}%</div>],
            ["", (b) => canManage && <button className="text-indigo-700 text-sm" onClick={() => setBudget(b)}>Edit</button>]]} />
        </Card>
      </div>
      {canManage && <Card title="Post journal entry">
        <form onSubmit={post} className="grid md:grid-cols-6 gap-2">
          <select className="input" required value={je.companyId} onChange={(e) => setJe({ ...je, companyId: e.target.value })}><option value="">Company…</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className="input" type="month" required value={je.period} onChange={(e) => setJe({ ...je, period: e.target.value })} />
          <select className="input" value={je.type} onChange={(e) => setJe({ ...je, type: e.target.value })}><option>EXPENSE</option><option>REVENUE</option></select>
          <input className="input" required placeholder="Category" value={je.category} onChange={(e) => setJe({ ...je, category: e.target.value })} />
          <input className="input" required type="number" min="0.01" step="0.01" placeholder={`Amount${cur ? ` (${cur})` : ""}`} value={je.amount} onChange={(e) => setJe({ ...je, amount: e.target.value })} />
          <button className="btn">Post</button>
        </form>
      </Card>}
      <Card title="Ledger (latest 200)">
        <div className="flex gap-2 mb-3">
          <select className="input max-w-xs" value={filter.companyId} onChange={(e) => setFilter({ ...filter, companyId: e.target.value })}><option value="">All companies</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="input max-w-xs" value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
            <option value="">All sources</option><option value="po:">Purchase orders</option><option value="manual:">Manual</option><option value="nifi">NiFi ingest</option><option value="seed">Opening data</option></select>
        </div>
        <Table rows={entries.data} cols={[["Period", (r) => r.period], ["Company", (r) => r.company.name], ["Type", (r) => r.type], ["Category", (r) => r.category],
          ["Amount", (r) => `${r.amount.toLocaleString()} ${r.currency}`], ["USD", (r) => usd(r.amountUsd)], ["Source", (r) => <span className="font-mono text-xs">{r.source}</span>]]} />
      </Card>
    </Page>
  );
}
