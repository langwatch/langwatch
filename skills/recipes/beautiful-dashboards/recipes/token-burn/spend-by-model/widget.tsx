import { Bars } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  // Pivot (day, model, cost) rows into one row per day with a column per model.
  const byDay = {};
  const models = [];
  for (const r of data) {
    const day = String(r.day).slice(0, 10);
    const model = String(r.model || "unknown");
    if (!models.includes(model)) models.push(model);
    byDay[day] = byDay[day] || { day };
    byDay[day][model] = Number(r.cost);
  }
  const rows = Object.values(byDay);

  return <Bars data={rows} x="day" series={models.map((k) => ({ key: k }))} stacked format="currency" legend />;
}
