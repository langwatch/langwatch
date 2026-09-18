import { Histogram, formatValue } from "@langwatch/charts";

const ORDER = ["<1m", "1-5m", "5-15m", "15-60m", ">1h"];

export default function Widget() {
  const b = LW.useChartQuery("buckets", {});
  const s = LW.useChartQuery("stats", {});
  if (b.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{b.error.message}</div>;
  if (b.isLoading || b.data === null || s.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (b.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const byLabel = {};
  for (const r of b.data) byLabel[String(r.bucket)] = Number(r.value);
  const buckets = ORDER.map((label) => ({ label, value: byLabel[label] || 0 }));
  const st = s.data[0] || {};

  return (
    <Histogram
      buckets={buckets}
      stats={[
        { label: "p50", value: formatValue(Number(st.p50_min) || 0, "duration_min") },
        { label: "p90", value: formatValue(Number(st.p90_min) || 0, "duration_min") },
      ]}
    />
  );
}
