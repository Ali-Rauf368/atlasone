import { useEffect, useState } from "react";
import { api, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Page } from "../components/ui";

interface Step { role: string; label: string; slaHours: number; budgetCheck?: boolean }
interface Rule { name: string; minAmountUsd: number; maxAmountUsd: number | null; steps: Step[] }
const ROLES = ["REGIONAL_DIRECTOR", "FINANCE", "GLOBAL_CEO", "COMPANY_ADMIN", "DEPARTMENT_MANAGER"];

/** Approval-matrix editor. Server validates contiguity and that every chain contains a budget check. */
export default function Workflow() {
  const { data, reload } = useApi<Rule[]>("/workflow/rules");
  const [rules, setRules] = useState<Rule[]>([]); const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  useEffect(() => { if (data) setRules(structuredClone(data)); }, [data]);

  const upd = (i: number, f: (r: Rule) => void) => setRules((rs) => { const c = structuredClone(rs); f(c[i]); return c; });
  async function save() {
    try { await api("/workflow/rules", { method: "PUT", body: JSON.stringify(rules) }); setMsg({ t: "Saved. New purchase orders use this matrix; orders already in flight keep their original chain.", ok: true }); reload(); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }

  return (
    <Page title="Approval workflow rules" actions={<div className="space-x-2">
      <button className="btn bg-slate-600" onClick={() => setRules([...rules, { name: `New band ${rules.length + 1}`, minAmountUsd: 0, maxAmountUsd: null, steps: [{ role: "FINANCE", label: "Finance budget validation", slaHours: 24, budgetCheck: true }] }])}>Add band</button>
      <button className="btn" onClick={save}>Save matrix</button></div>}>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</p>}
      <p className="text-sm text-slate-500">Bands must be contiguous from $0, the last one open-ended, and every chain must include a budget-check step. Changes are recorded in the audit log.</p>
      {rules.map((r, i) => (
        <Card key={i}>
          <div className="grid md:grid-cols-4 gap-3 mb-3">
            <input className="input" value={r.name} onChange={(e) => upd(i, (x) => { x.name = e.target.value; })} />
            <label className="text-xs text-slate-500">From (USD)<input className="input" type="number" value={r.minAmountUsd} onChange={(e) => upd(i, (x) => { x.minAmountUsd = Number(e.target.value); })} /></label>
            <label className="text-xs text-slate-500">To (USD, empty = ∞)<input className="input" type="number" value={r.maxAmountUsd ?? ""} onChange={(e) => upd(i, (x) => { x.maxAmountUsd = e.target.value === "" ? null : Number(e.target.value); })} /></label>
            <button className="text-sm text-red-600 justify-self-end" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove band</button>
          </div>
          <div className="text-xs text-slate-500 mb-2">{usd(r.minAmountUsd)} – {r.maxAmountUsd == null ? "∞" : usd(r.maxAmountUsd)}</div>
          {r.steps.map((s, k) => (
            <div key={k} className="grid grid-cols-12 gap-2 mb-2 items-center text-sm">
              <span className="col-span-1 text-slate-400">#{k + 1}</span>
              <select className="input col-span-3" value={s.role} onChange={(e) => upd(i, (x) => { x.steps[k].role = e.target.value; })}>{ROLES.map((ro) => <option key={ro}>{ro}</option>)}</select>
              <input className="input col-span-4" value={s.label} onChange={(e) => upd(i, (x) => { x.steps[k].label = e.target.value; })} />
              <label className="col-span-2 flex items-center gap-1"><input className="input" type="number" min="1" value={s.slaHours} onChange={(e) => upd(i, (x) => { x.steps[k].slaHours = Number(e.target.value); })} />h</label>
              <label className="col-span-1 text-xs flex gap-1"><input type="checkbox" checked={!!s.budgetCheck} onChange={(e) => upd(i, (x) => { x.steps[k].budgetCheck = e.target.checked; })} />budget</label>
              <button className="col-span-1 text-red-600" onClick={() => upd(i, (x) => { x.steps.splice(k, 1); })}>✕</button>
            </div>))}
          <button className="text-sm text-indigo-700" onClick={() => upd(i, (x) => { x.steps.push({ role: "GLOBAL_CEO", label: "CEO sign-off", slaHours: 72 }); })}>+ Add step</button>
        </Card>))}
    </Page>
  );
}
