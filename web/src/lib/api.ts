export interface User { uid: string; name: string; email: string; roles: string[] }
export const session = {
  get: (): { token: string; user: User } | null => JSON.parse(localStorage.getItem("atlas") ?? "null"),
  set: (s: { token: string; user: User }) => localStorage.setItem("atlas", JSON.stringify(s)),
  clear: () => localStorage.removeItem("atlas"),
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = session.get();
  const res = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...(s && { Authorization: `Bearer ${s.token}` }), ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && s) { session.clear(); location.href = "/login"; }
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error));
  return body as T;
}
export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: n >= 1e6 ? 1 : 0 }).format(n);
export const hasRole = (u: User | undefined, ...r: string[]) => !!u?.roles.some((x) => r.includes(x));
