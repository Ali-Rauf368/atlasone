import { useEffect, useState } from "react";
import { api, hasRole, session, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Badge, Card, Page } from "../components/ui";

interface Company { id: string; name: string; currency: string }
interface Step { id: string; index: number; role: string; label: string; dueAt: string; decision: string | null; decidedBy: string | null; comment: string | null; decidedAt: string | null; escalated: boolean }
interface Po { id: string; number: string; supplier: string; description: string; amount: string; currency: string; amountUsd: string; status: string; createdBy: string; createdAt: string; currentStep: number; ruleName: string; company: { name: string }; steps: Step[] }
interface Rule { name: string; minAmountUsd: number; maxAmountUsd: number | null; steps: { role: string; label: string; slaHours: number; budgetCheck?: boolean }[] }

const roleLabel = (r: string) => r.replace(/_/g, " ").toLowerCase();

function Timeline({ po }: { po: Po }) {
  return (
    <ol className="flex flex-wrap gap-2 items-center text-xs">
      <li className="px-2 py-1 rounded bg-slate-100">Created by {po.createdBy}</li>
      {po.steps.map((s) => {
        const active = po.status === "PENDING_APPROVAL" && s.index === po.currentStep;
        const overdue = active && new Date(s.dueAt) < new Date();
        const cls = s.decision === "APPROVE" ? "bg-emerald-100 text-emerald-800" : s.decision === "REJECT" ? "bg-red-100 text-red-800"
          : overdue || s.escalated ? "bg-orange-100 text-orange-800 ring-1 ring-orange-400" : active ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400" : "bg-slate-50 text-slate-400";
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span className="text-slate-300">→</span>
            <span className={`px-2 py-1 rounded ${cls}`} title={s.comment ?? ""}>
              {s.label}
              {s.decision ? ` · ${s.decision === "APPROVE" ? "✓" : "✗"} ${s.decidedBy}` : active ? ` · due ${new Date(s.dueAt).toLocaleString()}` : ""}
              {(overdue || s.escalated) && " · ESCALATED"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function PurchaseOrders() {
  const user = session.get()?.user;
  const [tab, setTab] = useState<"all" | "inbox">("inbox");
  const list = useApi<Po[]>(tab === "inbox" ? "/purchase-orders/inbox" : "/purchase-orders");
  const companies = useApi<Company[]>("/dashboard/companies");
  const rules = useApi<Rule[]>("/workflow/rules");
  const [form, setForm] = useState({ companyId: "", supplier: "", description: "", amount: "" });
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { const r = () => list.reload(); window.addEventListener("atlas:refresh", r); return () => window.removeEventListener("atlas:refresh", r); }, [list.reload]);

  const canCreate = hasRole(user, "DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR", "COMPANY_ADMIN");
  const company = companies.data?.find((c) => c.id === form.companyId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const po = await api<Po>("/purchase-orders", { method: "POST", body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      setMsg({ text: `${po.number} submitted · route: ${po.ruleName}`, ok: true }); setForm({ ...form, supplier: "", description: "", amount: "" });
      setTab("all"); list.reload();
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); }
  }
  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    const comment = decision === "REJECT" ? prompt("Reason for rejection (required)") : prompt("Comment (optional)") ?? undefined;
    if (decision === "REJECT" && !comment) return;
    try { await api(`/purchase-orders/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, comment: comment || undefined }) }); setMsg(null); list.reload(); }
    catch (e) { setMsg({ text: (e as Error).message, ok: false }); list.reload(); }
  }
  const canAct = (p: Po) => p.status === "PENDING_APPROVAL" && p.createdBy !== user?.uid && hasRole(user, p.steps[p.currentStep]?.role);

  return (
    <Page title="Purchase orders" actions={
      <div className="flex rounded-md border overflow-hidden text-sm">
        {(["inbox", "all"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-indigo-600 text-white" : "bg-white"}`}>{t === "inbox" ? "My approvals" : "All orders"}</button>)}
      </div>}>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}

      <Card title="Approval matrix">
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          {rules.data?.map((r) => (
            <div key={r.name} className="rounded-lg bg-slate-50 p-3">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-slate-500 mb-2">{usd(r.minAmountUsd)} – {r.maxAmountUsd == null ? "∞" : usd(r.maxAmountUsd)}</div>
              <ol className="text-xs space-y-1">{r.steps.map((s, i) => <li key={i}>{i + 1}. {s.label} <span className="text-slate-400">({roleLabel(s.role)}, SLA {s.slaHours}h{s.budgetCheck ? ", budget" : ""})</span></li>)}</ol>
            </div>))}
        </div>
      </Card>

      {canCreate && (
        <Card title="New purchase order">
          <form onSubmit={create} className="grid md:grid-cols-5 gap-3 items-end">
            <select className="input" required value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Company…</option>{companies.data?.filter((c) => c.currency && c.name !== "AtlasOne Holdings").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
            </select>
            <input className="input" required placeholder="Supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            <input className="input" required placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input className="input" required type="number" min="1" placeholder={`Amount${company ? ` (${company.currency})` : ""}`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <button className="btn">Create PO</button>
          </form>
        </Card>)}

      <Card title={tab === "inbox" ? "Waiting for my decision" : "All orders in my scope"}>
        {!list.data ? <p className="text-sm text-slate-400">Loading…</p> : !list.data.length ? <p className="text-sm text-slate-400">{tab === "inbox" ? "Nothing waiting for you." : "No orders yet."}</p> :
          <div className="divide-y">{list.data.map((p) => (
            <div key={p.id} className="py-3 space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-sm">
                <button className="font-mono text-indigo-700" onClick={() => setOpen(open === p.id ? null : p.id)}>{p.number}</button>
                <span>{p.company.name}</span><span className="text-slate-500">{p.supplier}</span>
                <span>{Number(p.amount).toLocaleString()} {p.currency} <span className="text-slate-400">({usd(Number(p.amountUsd))})</span></span>
                <Badge s={p.status} />
                <span className="ml-auto space-x-2">{canAct(p) && <>
                  <button className="btn" onClick={() => decide(p.id, "APPROVE")}>Approve</button>
                  <button className="btn bg-red-600 hover:bg-red-700" onClick={() => decide(p.id, "REJECT")}>Reject</button></>}</span>
              </div>
              <Timeline po={p} />
              {open === p.id && <div className="text-xs text-slate-600 bg-slate-50 rounded p-2">
                <div>{p.description} · rule: {p.ruleName} · created {new Date(p.createdAt).toLocaleString()}</div>
                {p.steps.filter((s) => s.comment).map((s) => <div key={s.id}>“{s.comment}” — {s.decidedBy} ({s.label})</div>)}
              </div>}
            </div>))}</div>}
      </Card>
    </Page>
  );
}
