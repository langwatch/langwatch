import { RankedList, formatValue } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => ({
    title: String(r.title || "Untitled session"),
    sub: `${String(r.day).slice(0, 10)} · ${String(r.repo || "no repo")} · ${formatValue(Number(r.tokens), "tokens")} tokens`,
    value: Number(r.cost),
    format: "currency",
    onClick: () => LW.navigate("traces", { "metadata.session_id": String(r.id) }),
  }));

  return <RankedList rows={rows} max={5} emptyText="No sessions in this window." />;
}
