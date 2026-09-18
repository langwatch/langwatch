import { RankedList, formatValue } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>Nothing ran at night this week.</div>;

  const rows = data.map((r) => ({
    title: String(r.title || "Untitled"),
    sub: `${String(r.day).slice(0, 10)} · ${r.repo || ""} · from ${r.window_start} · ${r.commits} commits`,
    value: Number(r.cost),
    format: "currency",
  }));

  return <RankedList rows={rows} max={8} emptyText="Nothing ran at night this week." />;
}
