import { ScatterDots, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No compactions in this window.</div>;

  const rows = data.map((r) => ({ day: String(r.day).slice(0, 10), at_k: Number(r.at_k), trigger: String(r.trigger || "auto") }));
  return (
    <ScatterDots
      data={rows}
      x="day"
      y="at_k"
      seriesKey="trigger"
      colors={{ auto: TOKENS.ramp[0], manual: TOKENS.ramp[4] }}
      xIsTime
      yDomain={[0, 700]}
      referenceLines={[{ y: 314, label: "optimum 314k", color: TOKENS.faint, dashed: true }]}
      legend
    />
  );
}
