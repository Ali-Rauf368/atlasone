import type { ReactNode } from "react";
export const Page = ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
  <div className="space-y-6"><div className="flex flex-wrap gap-3 justify-between items-center"><h1 className="text-2xl font-bold">{title}</h1>{actions}</div>{children}</div>);
export const Card = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => (
  <div className={`card ${className}`}>{title && <h2 className="font-semibold mb-3">{title}</h2>}{children}</div>);
export const Kpi = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="card"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div></div>);
export function Table<T>({ rows, cols, empty = "Nothing here yet" }: { rows: T[] | undefined; cols: [string, (r: T) => ReactNode][]; empty?: string }) {
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">{empty}</p>;
  return (<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr>{cols.map(([h]) => <th key={h} className="pr-3">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{cols.map(([h, f]) => <td key={h} className="py-2 pr-3">{f(r)}</td>)}</tr>)}</tbody></table></div>);
}
const tone: Record<string, string> = { ACTIVE: "emerald", APPROVED: "emerald", WON: "emerald", DELIVERED: "emerald", SENT_TO_SUPPLIER: "emerald",
  ONBOARDING: "sky", PENDING: "amber", IN_TRANSIT: "sky", PROPOSAL: "sky", QUALIFIED: "sky", LEAD: "slate", OPEN: "sky",
  REJECTED: "red", LOST: "red", DELAYED: "red", TERMINATED: "slate", PENDING_APPROVAL: "amber" };
const cls: Record<string, string> = { emerald: "bg-emerald-100 text-emerald-800", sky: "bg-sky-100 text-sky-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", slate: "bg-slate-100 text-slate-700" };
export const Badge = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${cls[tone[s] ?? "slate"]}`}>{s.replace(/_/g, " ")}</span>;
