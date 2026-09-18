import { LineChart, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No usage recorded for this department yet.</div>;

  const totals = {};
  for (const r of data) totals[String(r.tool)] = (totals[String(r.tool)] || 0) + Number(r.cost);
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const byMonth = {};
  for (const r of data) {
    const t = String(r.tool);
    if (!top.includes(t)) continue;
    const m = String(r.month).slice(0, 7);
    byMonth[m] = byMonth[m] || { month: m };
    byMonth[m][t] = Number(r.cost);
  }
  const months = Object.keys(byMonth).sort();
  const base = {};
  for (const t of top) base[t] = byMonth[months[0]]?.[t] || 0;
  const rows = months.map((m) => {
    const row = { month: m.slice(0, 7) };
    for (const t of top) row[t] = base[t] > 0 ? (byMonth[m][t] || 0) / base[t] : 0;
    return row;
  });

  return (
    <LineChart
      data={rows}
      x="month"
      format="percent"
      series={top.map((t, i) => ({ key: t, label: t, color: TOKENS.ramp[i % TOKENS.ramp.length], width: 2 }))}
      legend
    />
  );
}
