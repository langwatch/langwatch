import { RankedList } from "@langwatch/charts";

export default function Widget() {
  const s = LW.useChartQuery("servers", {});
  const t = LW.useChartQuery("total", {});
  if (s.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{s.error.message}</div>;
  if (s.isLoading || s.data === null || t.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (s.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const total = Number(t.data[0]?.n) || 1;
  const rows = s.data.map((r) => ({
    title: String(r.name),
    sub: `in ${Math.round((Number(r.sessions) / total) * 100)}% of sessions`,
    value: Number(r.sessions),
    format: "number",
  }));

  return <RankedList rows={rows} max={8} />;
}
