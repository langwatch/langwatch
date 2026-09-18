import { ComboChart } from "@langwatch/charts";

export default function Widget() {
  const s = LW.useChartQuery("sessions", {});
  const p = LW.useChartQuery("prs", {});
  if (s.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{s.error.message}</div>;
  if (s.isLoading || s.data === null || p.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (s.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const prByWeek = {};
  for (const r of p.data) prByWeek[String(r.week).slice(0, 10)] = Number(r.merged);
  const rows = s.data.map((r) => {
    const week = String(r.week).slice(0, 10);
    return { week, "merged pull requests": prByWeek[week] || 0, commits: Number(r.commits), "assistant cost": Number(r.cost) };
  });

  return (
    <ComboChart
      data={rows}
      x="week"
      bars={["merged pull requests", "commits"]}
      lines={["assistant cost"]}
      leftFormat="number"
      rightFormat="currency"
    />
  );
}
