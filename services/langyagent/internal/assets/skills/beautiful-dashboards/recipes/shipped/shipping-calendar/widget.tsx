import { CalendarHeatmap, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No merged pull requests in the last 3 months.</div>;

  const total = data.reduce((s, r) => s + Number(r.value), 0);
  const cal = data.map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) }));

  return (
    <div style={{ height: "100%" }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <strong>{total}</strong> <span style={{ color: TOKENS.muted }}>pull requests merged in the last 3 months</span>
      </div>
      <CalendarHeatmap data={cal} days={90} color={TOKENS.ok} />
    </div>
  );
}
