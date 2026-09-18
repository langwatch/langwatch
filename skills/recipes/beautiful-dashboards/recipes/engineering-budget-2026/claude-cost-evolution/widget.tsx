import { Bars } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No Claude Code spend for this department yet.</div>;

  const byMonth = {};
  for (const r of data) {
    const m = String(r.month).slice(0, 7);
    byMonth[m] = byMonth[m] || { month: m, Seat: 0, Usage: 0 };
    if (String(r.charge) === "seat") byMonth[m].Seat = Number(r.cost);
    else byMonth[m].Usage = Number(r.cost);
  }
  return <Bars data={Object.values(byMonth)} x="month" series={[{ key: "Seat" }, { key: "Usage" }]} stacked format="currency" legend />;
}
