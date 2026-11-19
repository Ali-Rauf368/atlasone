import { useState } from "react";
import { api, hasRole, session, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Kpi, Page, Table } from "../components/ui";

interface Deal { id: string; title: string; stage: string; valueUsd: string; owner: string; customer: { name: string; country: string } }
interface Stage { stage: string; count: number; valueUsd: number; deals: Deal[] }
const STAGES = ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"];

export default function CRM() {
  const canWrite = hasRole(session.get()?.user, "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR", "SUPER_ADMIN");
  const [q, setQ] = useState(""); const [msg, setMsg] = useState("");
  const pipe = useApi<Stage[]>("/crm/pipeline");
  const custs = useApi<{ id: string; name: string; country: string; industry: string; company: { name: string }; _count: { deals: number; contracts: number } }[]>(`/crm/customers?q=${encodeURIComponent(q)}`);
  const contracts = useApi<{ id: string; title: string; valueUsd: string; endsAt: string; customer: { name: string } }[]>("/crm/contracts");
  const perf = useApi<{ owner: string; wonUsd: number; won: number; winRate: number }[]>("/crm/performance");
  const move = (id: string, stage: string) => api(`/crm/deals/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) }).then(() => { pipe.reload(); perf.reload(); }).catch((e) => setMsg(e.message));
  const open = pipe.data?.filter((s) => !["WON", "LOST"].includes(s.stage)).reduce((a, s) => a + s.valueUsd, 0);

  return (
    <Page title="CRM & sales">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Customers" value={custs.data?.length ?? "…"} />
        <Kpi label="Open pipeline" value={open != null ? usd(open) : "…"} />
        <Kpi label="Won" value={pipe.data ? usd(pipe.data.find((s) => s.stage === "WON")?.valueUsd ?? 0) : "…"} />
        <Kpi label="Contracts expiring in 90 days" value={contracts.data?.filter((c) => new Date(c.endsAt).getTime() - Date.now() < 90 * 864e5).length ?? "…"} />
      </div>
      <Card title="Sales pipeline">
        <div className="grid md:grid-cols-5 gap-3">
          {pipe.data?.map((s) => (
            <div key={s.stage} className="bg-slate-50 rounded-lg p-2 min-h-40">
              <div className="text-xs font-semibold text-slate-600 mb-2">{s.stage} · {s.count} · {usd(s.valueUsd)}</div>
              {s.deals.map((d) => (
                <div key={d.id} className="bg-white border rounded-md p-2 mb-2 text-xs">
                  <div className="font-medium">{d.title}</div><div className="text-slate-500">{d.customer.name} · {usd(Number(d.valueUsd))}</div>
                  {canWrite && <select className="mt-1 w-full border rounded text-xs" value={d.stage} onChange={(e) => move(d.id, e.target.value)}>{STAGES.map((x) => <option key={x}>{x}</option>)}</select>}
                </div>))}
            </div>))}
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Sales performance"><Table rows={perf.data} cols={[["Owner", (p) => p.owner], ["Won", (p) => usd(p.wonUsd)], ["Deals", (p) => p.won], ["Win rate", (p) => `${(p.winRate * 100).toFixed(0)}%`]]} /></Card>
        <Card title="Customer contracts"><Table rows={contracts.data} cols={[["Customer", (c) => c.customer.name], ["Value", (c) => usd(Number(c.valueUsd))], ["Ends", (c) => c.endsAt.slice(0, 10)]]} /></Card>
      </div>
      <Card title="Global customer database">
        <input className="input mb-3 max-w-sm" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <Table rows={custs.data} cols={[["Customer", (c) => c.name], ["Country", (c) => c.country], ["Industry", (c) => c.industry], ["Managed by", (c) => c.company.name], ["Deals", (c) => c._count.deals], ["Contracts", (c) => c._count.contracts]]} />
      </Card>
    </Page>
  );
}
