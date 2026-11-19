import { Navigate } from "react-router-dom";
import { hasRole, session } from "../lib/api";
import Dashboard from "./Dashboard";
export default function Home() {
  return hasRole(session.get()?.user, "GLOBAL_CEO", "SUPER_ADMIN") ? <Dashboard /> : <Navigate to="/purchase-orders" replace />;
}
