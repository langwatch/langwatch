import { RankedList } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No skills ran in this window.</div>;

  const rows = data.map((r) => ({ title: String(r.name), sub: `${r.invocations} invocations`, value: Number(r.invocations), format: "number" }));
  return <RankedList rows={rows} max={8} />;
}
