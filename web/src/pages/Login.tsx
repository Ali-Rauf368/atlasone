import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, session, type User } from "../lib/api";

export default function Login() {
  const [username, setU] = useState("ceo"); const [password, setP] = useState("password");
  const [error, setError] = useState(""); const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { session.set(await api<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) })); location.href = "/"; }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <div className="min-h-screen grid place-items-center bg-slate-900">
      <form onSubmit={submit} className="card w-80 space-y-3">
        <h1 className="text-xl font-bold">AtlasOne sign in</h1>
        <p className="text-xs text-slate-500">Directory login (LDAP). Demo users: ceo, director, manager, finance / password</p>
        <input className="input" value={username} onChange={(e) => setU(e.target.value)} placeholder="Username" />
        <input className="input" type="password" value={password} onChange={(e) => setP(e.target.value)} placeholder="Password" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn w-full">Sign in</button>
      </form>
    </div>
  );
}
