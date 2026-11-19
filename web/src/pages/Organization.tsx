import { useState } from "react";
import { api, hasRole, session } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Page, Table } from "../components/ui";

interface Node { id: string; code: string; name: string; country: string; region: string; currency: string; industry: string; employees: number; departments: { id: string; name: string; employees: number }[]; children: Node[] }
interface Cfg { timezone: string; locale: string; fiscalYearStartMonth: number; vatRate: number | string; payrollCycle: string; dataResidency: string }
interface Country { country: string; companies: number; config: Cfg | null }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Tree({ n, depth = 0 }: { n: Node; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const total = (x: Node): number => x.employees + x.children.reduce((s, c) => s + total(c), 0);
  return (
    <div className={depth ? "ml-6 border-l pl-4" : ""}>
      <button className="flex items-center gap-2 py-1.5 text-left w-full hover:bg-slate-50 rounded" onClick={() => setOpen(!open)}>
        <span className="w-4 text-slate-400">{n.children.length || n.departments.length ? (open ? "▾" : "▸") : "·"}</span>
        <span className="font-medium">{n.name}</span>
        <span className="text-xs text-slate-500">{n.code} · {n.country} · {n.region} · {n.currency} · {n.industry}</span>
        <span className="ml-auto text-xs bg-slate-100 rounded px-2">{total(n)} people</span>
      </button>
      {open && <>
        {n.departments.length > 0 && <div className="ml-10 flex flex-wrap gap-2 py-1">{n.departments.map((d) => <span key={d.id} className="text-xs border rounded px-2 py-0.5">{d.name} · {d.employees}</span>)}</div>}
        {n.children.map((c) => <Tree key={c.id} n={c} depth={depth + 1} />)}
      </>}
    </div>
  );
}

export default function Organization() {
  const canManage = hasRole(session.get()?.user, "GLOBAL_CEO", "SUPER_ADMIN");
  const tree = useApi<Node[]>("/org/tree");
  const countries = useApi<Country[]>("/org/countries");
  const [edit, setEdit] = useState<{ country: string; cfg: Cfg } | null>(null);
  const [form, setForm] = useState({ code: "", name: "", country: "", region: "Europe", currency: "EUR", industry: "" });
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  async function saveCountry() {
    if (!edit) return;
    try { await api(`/org/countries/${encodeURIComponent(edit.country)}`, { method: "PUT", body: JSON.stringify({ ...edit.cfg, vatRate: Number(edit.cfg.vatRate) }) }); setEdit(null); countries.reload(); setMsg({ t: "Country configuration saved", ok: true }); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }
  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/org/companies", { method: "POST", body: JSON.stringify(form) }); tree.reload(); countries.reload(); setMsg({ t: `${form.name} added to the group`, ok: true }); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
  }
  const field = (k: keyof Cfg, el: JSX.Element) => <label className="text-xs text-slate-500">{k}{el}</label>;

  return (
    <Page title="Global organization">
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</p>}
      <Card title="Group hierarchy">{tree.data ? tree.data.map((n) => <Tree key={n.id} n={n} />) : <p className="text-sm text-slate-400">Loading…</p>}</Card>

      <Card title="Country-specific configuration">
        <Table rows={countries.data} cols={[["Country", (c) => c.country], ["Entities", (c) => c.companies], ["Timezone", (c) => c.config?.timezone ?? "—"], ["Locale", (c) => c.config?.locale ?? "—"],
          ["Fiscal year starts", (c) => (c.config ? MONTHS[c.config.fiscalYearStartMonth - 1] : "—")], ["VAT", (c) => (c.config ? `${Number(c.config.vatRate)}%` : "—")],
          ["Payroll", (c) => c.config?.payrollCycle ?? "—"], ["Data residency", (c) => c.config?.dataResidency ?? "—"],
          ["", (c) => canManage && <button className="text-indigo-700 text-sm" onClick={() => setEdit({ country: c.country, cfg: c.config ?? { timezone: "UTC", locale: "en", fiscalYearStartMonth: 1, vatRate: 0, payrollCycle: "MONTHLY", dataResidency: "LOCAL" } })}>Edit</button>]]} />
        {edit && <div className="mt-4 grid md:grid-cols-7 gap-2 items-end bg-slate-50 p-3 rounded">
          <div className="font-medium text-sm">{edit.country}</div>
          {field("timezone", <input className="input" value={edit.cfg.timezone} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, timezone: e.target.value } })} />)}
          {field("locale", <input className="input" value={edit.cfg.locale} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, locale: e.target.value } })} />)}
          {field("fiscalYearStartMonth", <select className="input" value={edit.cfg.fiscalYearStartMonth} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, fiscalYearStartMonth: Number(e.target.value) } })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>)}
          {field("vatRate", <input className="input" type="number" step="0.1" value={edit.cfg.vatRate} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, vatRate: e.target.value } })} />)}
          {field("payrollCycle", <select className="input" value={edit.cfg.payrollCycle} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, payrollCycle: e.target.value } })}>{["MONTHLY", "SEMI_MONTHLY", "BIWEEKLY"].map((x) => <option key={x}>{x}</option>)}</select>)}
          <div className="flex gap-2">{field("dataResidency", <select className="input" value={edit.cfg.dataResidency} onChange={(e) => setEdit({ ...edit, cfg: { ...edit.cfg, dataResidency: e.target.value } })}>{["EU", "US", "UK", "APAC", "LOCAL"].map((x) => <option key={x}>{x}</option>)}</select>)}
            <button className="btn self-end" onClick={saveCountry}>Save</button></div>
        </div>}
      </Card>

      {canManage && <Card title="Add subsidiary">
        <form onSubmit={addCompany} className="grid md:grid-cols-7 gap-2">
          <input className="input" required placeholder="Code e.g. FR-RETAIL" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <input className="input md:col-span-2" required placeholder="Legal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" required placeholder="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <select className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>{["Europe", "Asia", "Americas", "Africa", "Middle East", "Oceania"].map((r) => <option key={r}>{r}</option>)}</select>
          <input className="input" required maxLength={3} placeholder="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          <div className="flex gap-2"><input className="input" required placeholder="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /><button className="btn">Add</button></div>
        </form>
      </Card>}
    </Page>
  );
}
