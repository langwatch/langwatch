import { LineChart, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => ({ day: String(r.day).slice(5, 10), median: Number(r.p50), p90: Number(r.p90), max: Number(r.max_k) }));
  return (
    <LineChart
      data={rows}
      x="day"
      format="tokens_k"
      series={[
        { key: "max", label: "max", color: TOKENS.faint, dashed: true },
        { key: "p90", label: "p90", color: TOKENS.ramp[2] },
        { key: "median", label: "median", color: TOKENS.ramp[0], width: 2 },
      ]}
      referenceAreas={[{ y1: 250, y2: 450, label: "cheapest 250k-450k", color: TOKENS.ramp[0], opacity: 0.09 }]}
      referenceLines={[{ y: 500, label: "alert 500k", color: TOKENS.danger, dashed: true }]}
      legend
    />
  );
}
