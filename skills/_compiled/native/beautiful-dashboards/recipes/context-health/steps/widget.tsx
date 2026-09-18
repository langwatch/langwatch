import { Histogram } from "@langwatch/charts";

const ORDER = ["1-10", "11-25", "26-50", "51-100", "101-350", "350+"];

export default function Widget() {
  const h = LW.useChartQuery("hist", {});
  const s = LW.useChartQuery("stats", {});
  if (h.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{h.error.message}</div>;
  if (h.isLoading || h.data === null || s.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (h.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const byLabel = {};
  for (const r of h.data) byLabel[String(r.bucket)] = Number(r.value);
  const buckets = ORDER.map((label) => ({ label, value: byLabel[label] || 0 }));
  const st = s.data[0] || {};

  return (
    <Histogram
      buckets={buckets}
      stats={[
        { label: "p50 steps", value: Math.round(Number(st.p50) || 0) },
        { label: "p90 steps", value: Math.round(Number(st.p90) || 0) },
        { label: "p99 steps", value: Math.round(Number(st.p99) || 0) },
      ]}
    />
  );
}
