import { RankedList } from "@langwatch/charts";

export default function Widget() {
  const servers = LW.useChartQuery("servers", {});
  const calls = LW.useChartQuery("calls", {});
  const total = LW.useChartQuery("total", {});
  if (servers.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{servers.error.message}</div>;
  if (servers.isLoading || servers.data === null || calls.data === null || total.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (servers.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No MCP servers loaded in this window.</div>;

  const callBy = {};
  for (const r of calls.data) callBy[String(r.name)] = Number(r.calls);
  const totalSessions = Number(total.data[0]?.n) || 1;

  // Loaded widely, but called little: the ones worth unloading or deferring.
  const rows = servers.data
    .map((r) => ({ name: String(r.name), sessions: Number(r.sessions), calls: callBy[String(r.name)] || 0 }))
    .filter((r) => r.calls <= r.sessions)
    .map((r) => ({
      title: r.name,
      sub: `loaded in ${Math.round((r.sessions / totalSessions) * 100)}% of sessions · called ${r.calls}x`,
      value: "unload or defer",
    }));
  if (rows.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>Every loaded MCP server earns its place this week.</div>;

  return <RankedList rows={rows} max={5} />;
}
