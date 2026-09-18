import { Bars } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => ({ day: String(r.day).slice(0, 10), working: Number(r.working), "waiting on me": Number(r.waiting) }));
  return <Bars data={rows} x="day" series={["working", "waiting on me"]} stacked format="duration_min" legend />;
}
