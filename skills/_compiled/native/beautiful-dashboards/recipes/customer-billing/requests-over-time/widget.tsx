import { AreaTimeseries } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No gateway traffic in this window.</div>;

  const rows = data.map((r) => ({ day: String(r.day).slice(0, 10), requests: Number(r.requests) }));
  return <AreaTimeseries data={rows} x="day" series="requests" format="number" />;
}
