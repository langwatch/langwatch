import { AreaTimeseries } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No Genie questions recorded in this window.</div>;

  const rows = data.map((r) => ({ month: String(r.month).slice(0, 7), questions: Number(r.questions) }));
  return <AreaTimeseries data={rows} x="month" series="questions" format="number" />;
}
