import { GroupedBars } from "@langwatch/charts";

// PLAN CONSTANTS — child plan ENG_2026_CLAUDE, same ramp phasing.
const CLAUDE_AMOUNT = 84_000;
const PHASING = [0.85, 0.88, 0.91, 0.94, 0.97, 1.0, 1.03, 1.06, 1.09, 1.12, 1.14, 1.15];
const monthBudget = (m) => (CLAUDE_AMOUNT / 12) * PHASING[m];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No Claude Code spend for this department yet.</div>;

  const rows = data.map((r) => {
    const m = new Date(String(r.month)).getUTCMonth();
    return { month: String(r.month).slice(0, 7), Budget: monthBudget(m), Cost: Number(r.cost) };
  });
  return <GroupedBars data={rows} x="month" series={["Budget", "Cost"]} format="currency" />;
}
