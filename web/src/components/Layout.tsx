import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, hasRole, session } from "../lib/api";
import Notifications from "./Notifications";

const nav: [string, string, string[] | null][] = [
  ["/", "Global dashboard", ["GLOBAL_CEO", "SUPER_ADMIN"]],
  ["/organization", "Organization", ["GLOBAL_CEO", "SUPER_ADMIN", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "FINANCE"]],
  ["/finance", "Finance", ["GLOBAL_CEO", "SUPER_ADMIN", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "FINANCE"]],
  ["/reports", "Reports & forecast", ["GLOBAL_CEO", "SUPER_ADMIN", "FINANCE", "REGIONAL_DIRECTOR", "COMPANY_ADMIN"]],
  ["/purchase-orders", "Purchase orders", null],
  ["/hr", "Human resources", ["GLOBAL_CEO", "SUPER_ADMIN", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "FINANCE"]],
  ["/supply-chain", "Supply chain", null],
  ["/crm", "CRM & sales", ["GLOBAL_CEO", "SUPER_ADMIN", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER"]],
  ["/audit", "Audit log", ["GLOBAL_CEO", "SUPER_ADMIN", "FINANCE"]],
  ["/workflow", "Workflow rules", ["GLOBAL_CEO", "SUPER_ADMIN"]],
  ["/security", "Security center", ["GLOBAL_CEO", "SUPER_ADMIN"]],
];

export default function Layout() {
  const s = session.get(); const go = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) => `block px-3 py-2 rounded-md text-sm ${isActive ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-800"}`;
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-slate-900 p-4 flex flex-col gap-1">
        <div className="text-white font-bold text-lg mb-6">AtlasOne</div>
        {nav.filter(([, , r]) => !r || hasRole(s?.user, ...r)).map(([to, label]) => <NavLink key={to} to={to} end className={link}>{label}</NavLink>)}
        <Notifications />
        <a href="/api/docs" target="_blank" rel="noreferrer" className="block px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-800">API docs ↗</a>
        <div className="mt-auto text-xs text-slate-400">
          <div className="text-slate-200">{s?.user.name}</div><div>{s?.user.roles.join(", ")}</div>
          <button className="mt-2 underline" onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); session.clear(); go("/login"); }}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 p-8 min-w-0"><Outlet /></main>
    </div>
  );
}
