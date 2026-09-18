import { GroupedBars } from "@langwatch/charts";

const ENG_2026_AMOUNT = 240_000; // PLAN CONSTANT — no Plan model yet.

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No team-attributed spend for this department yet.</div>;

  const total = data.reduce((s, r) => s + Number(r.cost), 0) || 1;
  const rows = data.map((r) => ({ team: String(r.team), Budget: ENG_2026_AMOUNT * (Number(r.cost) / total), Cost: Number(r.cost) }));
  return <GroupedBars data={rows} x="team" series={["Budget", "Cost"]} format="currency" />;
}
