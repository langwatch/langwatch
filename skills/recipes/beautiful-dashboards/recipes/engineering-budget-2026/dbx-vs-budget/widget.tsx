import { GroupedBars } from "@langwatch/charts";

// PLAN CONSTANTS — child plan ENG_2026_DBX, FLAT phasing.
const DBX_AMOUNT = 66_000;
const monthBudget = () => DBX_AMOUNT / 12;

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No Databricks Genie spend recorded yet.</div>;

  const rows = data.map((r) => ({ month: String(r.month).slice(0, 7), Budget: monthBudget(), Cost: Number(r.cost) }));
  return <GroupedBars data={rows} x="month" series={["Budget", "Cost"]} format="currency" />;
}
