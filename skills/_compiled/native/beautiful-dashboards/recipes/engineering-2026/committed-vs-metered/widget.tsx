import { Bars } from "@langwatch/charts";

const CHARGES = ["seat", "cloud", "usage", "activity"];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No usage recorded for this department yet.</div>;

  const present = [];
  const byMonth = {};
  for (const r of data) {
    const c = String(r.charge);
    if (!present.includes(c)) present.push(c);
    const m = String(r.month).slice(0, 7);
    byMonth[m] = byMonth[m] || { month: m };
    byMonth[m][c] = Number(r.cost);
  }
  const series = CHARGES.filter((c) => present.includes(c));
  return <Bars data={Object.values(byMonth)} x="month" series={series} stacked colorBy="charge" format="currency" legend />;
}
