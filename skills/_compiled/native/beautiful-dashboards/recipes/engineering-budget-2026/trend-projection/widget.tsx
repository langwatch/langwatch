import { ProjectionBars, TOKENS } from "@langwatch/charts";

// PLAN CONSTANTS — no Plan model exists yet; authored ENG_2026 phasing.
const ENG_2026_AMOUNT = 240_000;
const PHASING = [0.85, 0.88, 0.91, 0.94, 0.97, 1.0, 1.03, 1.06, 1.09, 1.12, 1.14, 1.15];
const monthBudget = (m) => (ENG_2026_AMOUNT / 12) * PHASING[m];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No usage recorded for this department yet.</div>;

  const costByMonth = {};
  for (const r of data) costByMonth[new Date(String(r.month)).getUTCMonth()] = Number(r.cost);
  const measured = Object.keys(costByMonth).length;
  const rate = measured > 0 ? Object.values(costByMonth).reduce((s, v) => s + v, 0) / measured : 0;

  const rows = MONTHS.map((label, m) => ({ month: label, cost: costByMonth[m] !== undefined ? costByMonth[m] : rate }));

  return (
    <ProjectionBars
      data={rows}
      x="month"
      y="cost"
      projectionFrom={measured}
      budget={monthBudget(5)}
      colors={{ budget: TOKENS.danger }}
    />
  );
}
