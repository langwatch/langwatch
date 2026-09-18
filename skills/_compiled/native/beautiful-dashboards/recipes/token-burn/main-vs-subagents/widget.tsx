import { Bars } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const byDay = {};
  const types = [];
  for (const r of data) {
    const day = String(r.day).slice(0, 10);
    const t = String(r.agent_type);
    if (!types.includes(t)) types.push(t);
    byDay[day] = byDay[day] || { day };
    byDay[day][t] = Number(r.tokens);
  }
  return <Bars data={Object.values(byDay)} x="day" series={types} stacked colorBy="agent_type" format="tokens" legend />;
}
