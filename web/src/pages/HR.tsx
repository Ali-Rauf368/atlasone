import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, hasRole, session, usd } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Badge, Card, Kpi, Page, Table } from "../components/ui";

interface Emp { id: string; name: string; email: string; title: string; status: string; rating: number | null; company: { name: string; country: string }; department: { name: string } | null }
interface Leave { id: string; from: string; to: string; reason: string; status: string; employee: { name: string; company: { name: string } } }

export default function HR() {
  const user = session.get()?.user;
  const [q, setQ] = useState(""); const [page, setPage] = useState(1); const [msg, setMsg] = useState("");
  const emps = useApi<{ total: number; pageSize: number; rows: Emp[] }>(`/hr/employees?page=${page}&q=${encodeURIComponent(q)}`);
  const dist = useApi<{ name: string; country: string; active: number; onboarding: number }[]>("/hr/distribution");
  const leave = useApi<Leave[]>("/hr/leave");
  const att = useApi<{ rate: number | null }>("/hr/attendance");
  const payroll = useApi<{ company: string; currency: string; headcount: number; monthlyLocal: number; monthlyUsd: number }[]>(hasRole(user, "GLOBAL_CEO", "FINANCE", "COMPANY_ADMIN", "SUPER_ADMIN") ? "/hr/payroll" : null);
  const jobs = useApi<{ id: string; title: string; status: string }[]>("/hr/recruitment");
  const canApprove = hasRole(user, "DEPARTMENT_MANAGER", "COMPANY_ADMIN", "REGIONAL_DIRECTOR");
  const decide = (id: string, decision: string) => api(`/hr/leave/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }).then(leave.reload).catch((e) => setMsg(e.message));
  const total = dist.data?.reduce((a, c) => a + c.active + c.onboarding, 0);
  const pages = emps.data ? Math.ceil(emps.data.total / emps.data.pageSize) : 1;

  return (
    <Page title="Human resources">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Global headcount" value={total ?? "…"} />
        <Kpi label="Onboarding" value={dist.data?.reduce((a, c) => a + c.onboarding, 0) ?? "…"} />
        <Kpi label="Attendance (30 days)" value={att.data?.rate != null ? `${(att.data.rate * 100).toFixed(1)}%` : "—"} />
        <Kpi label="Open positions" value={jobs.data?.filter((j) => j.status === "OPEN").length ?? "…"} />
      </div>
      <Card title="Employee distribution by subsidiary" className="h-80">
        <ResponsiveContainer height="85%"><BarChart data={dist.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="country" /><YAxis /><Tooltip /><Legend />
          <Bar dataKey="active" stackId="a" fill="#4f46e5" /><Bar dataKey="onboarding" stackId="a" fill="#a5b4fc" /></BarChart></ResponsiveContainer>
      </Card>
      <Card title={`Global employee directory (${emps.data?.total ?? "…"})`}>
        <input className="input mb-3 max-w-sm" placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Table rows={emps.data?.rows} cols={[["Name", (e) => e.name], ["Title", (e) => e.title], ["Department", (e) => e.department?.name ?? "—"],
          ["Company", (e) => e.company.name], ["Country", (e) => e.company.country], ["Rating", (e) => e.rating ? "★".repeat(e.rating) : "—"], ["Status", (e) => <Badge s={e.status} />]]} />
        <div className="flex gap-2 items-center mt-3 text-sm"><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {pages}</span><button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Leave requests">
          <Table rows={leave.data} cols={[["Employee", (l) => l.employee.name], ["Dates", (l) => `${l.from.slice(0, 10)} → ${l.to.slice(0, 10)}`], ["Reason", (l) => l.reason],
            ["Status", (l) => l.status === "PENDING" && canApprove
              ? <span className="space-x-1"><button className="btn" onClick={() => decide(l.id, "APPROVED")}>Approve</button><button className="btn bg-red-600" onClick={() => decide(l.id, "REJECTED")}>Reject</button></span>
              : <Badge s={l.status} />]]} />
        </Card>
        {payroll.data && <Card title="Monthly payroll">
          <Table rows={payroll.data} cols={[["Company", (p) => p.company], ["Headcount", (p) => p.headcount], ["Local", (p) => `${p.monthlyLocal.toLocaleString()} ${p.currency}`], ["USD", (p) => usd(p.monthlyUsd)]]} />
        </Card>}
      </div>
    </Page>
  );
}
