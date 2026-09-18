import { Table } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => ({
    element: String(r.tool),
    p50: `${(Number(r.p50_s) || 0).toFixed(1)}s`,
    p90: `${(Number(r.p90_s) || 0).toFixed(1)}s`,
    "wall/week": `${Math.round(Number(r.total_min) || 0)} min`,
    _highlight: (Number(r.total_min) || 0) >= 60,
  }));

  return (
    <Table
      columns={[
        { key: "element", label: "element" },
        { key: "p50", label: "p50" },
        { key: "p90", label: "p90" },
        { key: "wall/week", label: "wall/week" },
      ]}
      rows={rows}
      highlight="_highlight"
      mono
    />
  );
}
