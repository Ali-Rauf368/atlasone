import { useState } from "react";
import { api, hasRole, session } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Badge, Card, Kpi, Page, Table } from "../components/ui";

interface Item { id: string; sku: string; name: string; quantity: number; reorderAt: number; warehouse: { name: string; company: { name: string } } }
interface Wh { id: string; name: string; city: string; company: { name: string }; skus: number; units: number; lowStock: number }
interface Ship { id: string; tracking: string; poNumber: string | null; origin: string; destination: string; status: string; eta: string }
interface Sup { id: string; name: string; country: string; email: string; rating: number }

export default function SupplyChain() {
  const canWrite = hasRole(session.get()?.user, "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR", "SUPER_ADMIN");
  const [lowOnly, setLowOnly] = useState(false); const [msg, setMsg] = useState("");
  const inv = useApi<Item[]>(`/scm/inventory?low=${lowOnly}`);
  const wh = useApi<Wh[]>("/scm/warehouses");
  const ships = useApi<Ship[]>("/scm/shipments");
  const sups = useApi<Sup[]>("/scm/suppliers");
  const adjust = (id: string, delta: number) => api(`/scm/inventory/${id}/adjust`, { method: "POST", body: JSON.stringify({ delta, reason: delta > 0 ? "Goods received" : "Goods issued" }) })
    .then(() => { inv.reload(); wh.reload(); setMsg(""); }).catch((e) => setMsg(e.message));
  const setShip = (id: string, status: string) => api(`/scm/shipments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }).then(ships.reload).catch((e) => setMsg(e.message));

  return (
    <Page title="Supply chain">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Suppliers" value={sups.data?.length ?? "…"} />
        <Kpi label="Warehouses" value={wh.data?.length ?? "…"} />
        <Kpi label="Low-stock SKUs" value={wh.data?.reduce((a, w) => a + w.lowStock, 0) ?? "…"} />
        <Kpi label="Shipments in transit" value={ships.data?.filter((s) => s.status !== "DELIVERED").length ?? "…"} />
      </div>
      <Card title="Shipment tracking">
        <Table rows={ships.data} cols={[["Tracking", (s) => <span className="font-mono">{s.tracking}</span>], ["PO", (s) => s.poNumber ?? "—"], ["Route", (s) => `${s.origin} → ${s.destination}`],
          ["ETA", (s) => s.eta.slice(0, 10)], ["Status", (s) => canWrite && s.status !== "DELIVERED"
            ? <select className="input py-1" value={s.status} onChange={(e) => setShip(s.id, e.target.value)}>{["IN_TRANSIT", "DELAYED", "DELIVERED"].map((x) => <option key={x}>{x}</option>)}</select>
            : <Badge s={s.status} />]]} />
      </Card>
      <Card title="Inventory">
        <label className="text-sm flex gap-2 mb-3"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Show low stock only</label>
        <Table rows={inv.data} cols={[["SKU", (i) => <span className="font-mono">{i.sku}</span>], ["Warehouse", (i) => i.warehouse.name], ["Company", (i) => i.warehouse.company.name],
          ["Qty", (i) => <span className={i.quantity <= i.reorderAt ? "text-red-600 font-semibold" : ""}>{i.quantity}</span>], ["Reorder at", (i) => i.reorderAt],
          ["", (i) => canWrite && <span className="space-x-1"><button className="btn" onClick={() => adjust(i.id, 10)}>+10</button><button className="btn bg-slate-600" onClick={() => adjust(i.id, -10)}>−10</button></span>]]} />
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Warehouses"><Table rows={wh.data} cols={[["Name", (w) => w.name], ["Company", (w) => w.company.name], ["SKUs", (w) => w.skus], ["Units", (w) => w.units.toLocaleString()]]} /></Card>
        <Card title="Global suppliers"><Table rows={sups.data} cols={[["Name", (s) => s.name], ["Country", (s) => s.country], ["Rating", (s) => "★".repeat(s.rating)]]} /></Card>
      </div>
    </Page>
  );
}
