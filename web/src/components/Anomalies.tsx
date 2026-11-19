import { useApi } from "../lib/useApi";
import { usd } from "../lib/api";
import { Card, Table } from "./ui";

interface Anomaly { company: string; country: string; type: string; period: string; value: number; expected: number; zScore: number; direction: "spike" | "drop" }

export default function Anomalies() {
  const { data, error } = useApi<Anomaly[]>("/reports/anomalies");
  return (
    <Card title="Anomaly detection (robust z-score, |z| > 3.5)">
      {error ? <p className="text-sm text-red-600">{error}</p> :
        <Table rows={data} empty="No unusual months detected." cols={[
          ["Company", (a) => a.company], ["Metric", (a) => a.type.toLowerCase()], ["Month", (a) => a.period],
          ["Actual", (a) => usd(a.value)], ["Typical", (a) => usd(a.expected)],
          ["Signal", (a) => <span className={a.direction === "spike" === (a.type === "EXPENSE") ? "text-red-600 font-semibold" : "text-amber-600 font-semibold"}>
            {a.direction === "spike" ? "▲" : "▼"} {a.direction} · z={a.zScore}</span>]]} />}
    </Card>
  );
}
