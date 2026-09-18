import { RankedList, formatValue, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const main = LW.useChartQuery("main", {});
  const total = LW.useChartQuery("total", {});
  if (main.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{main.error.message}</div>;
  if (main.isLoading || main.data === null || total.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (main.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const totalMin = Number(total.data[0]?.total_min) || 0;
  const rows = main.data.map((r) => ({
    title: String(r.title || "Untitled"),
    sub: String(r.repo || ""),
    value: Number(r.wait_min),
    format: "duration_min",
  }));

  return (
    <div style={{ height: "100%" }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <strong>{formatValue(totalMin, "duration_min")}</strong> <span style={{ color: TOKENS.muted }}>of agent wait time this week</span>
      </div>
      <RankedList rows={rows} max={5} />
    </div>
  );
}
