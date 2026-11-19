export interface Point { period: string; value: number }
export interface Anomaly { period: string; value: number; expected: number; zScore: number; direction: "spike" | "drop" }

/**
 * Robust anomaly detection using median / MAD (modified z-score, Iglewicz & Hoaglin).
 * Robust to the outliers themselves, unlike mean/stddev. |z| > threshold (default 3.5) is flagged.
 */
export function detectAnomalies(series: Point[], threshold = 3.5): Anomaly[] {
  if (series.length < 4) return [];
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const vals = series.map((p) => p.value), med = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - med)));
  if (mad === 0) return [];
  return series.flatMap((p) => {
    const z = (0.6745 * (p.value - med)) / mad;
    return Math.abs(z) > threshold ? [{ period: p.period, value: p.value, expected: med, zScore: Math.round(z * 100) / 100, direction: z > 0 ? "spike" as const : "drop" as const }] : [];
  });
}
