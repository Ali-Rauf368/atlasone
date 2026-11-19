export function nextPeriod(p: string, n = 1): string {
  const [y, m] = p.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Ordinary least squares on index → value, projected `horizon` periods ahead. */
export function linearForecast(series: { period: string; value: number }[], horizon: number) {
  const n = series.length;
  if (n < 2) return [];
  const xs = series.map((_, i) => i), ys = series.map((s) => s.value);
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const intercept = my - slope * mx;
  const last = series[n - 1].period;
  return Array.from({ length: horizon }, (_, k) => ({ period: nextPeriod(last, k + 1), value: Math.max(0, Math.round(intercept + slope * (n + k))) }));
}
