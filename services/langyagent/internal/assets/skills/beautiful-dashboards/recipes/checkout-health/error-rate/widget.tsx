import { LineChart, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No traffic in this window.</div>;

  const rows = data.map((r) => ({ day: String(r.day).slice(5, 10), "error rate": Number(r.rate) || 0 }));
  return <LineChart data={rows} x="day" format="percent" series={[{ key: "error rate", label: "error rate", color: TOKENS.danger, width: 2 }]} />;
}
