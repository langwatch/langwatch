import { StatTiles } from "@langwatch/charts";

// PLAN CONSTANTS — no Plan model exists yet; these are the authored ENG_2026 plan.
const ENG_2026_AMOUNT = 240_000;

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No usage recorded for this department yet.</div>;

  const cost = data.reduce((s, r) => s + Number(r.cost), 0);
  const monthsWithSpend = data.filter((r) => Number(r.cost) > 0).length || 1;
  const consumed = cost / ENG_2026_AMOUNT;
  const elapsed = monthsWithSpend / 12;
  const projected = (cost / monthsWithSpend) * 12;

  return (
    <StatTiles
      divided
      tiles={[
        { value: ENG_2026_AMOUNT, format: "currency", label: "budget" },
        { value: cost, format: "currency", label: "cost to date" },
        { value: consumed, format: "percent", label: "consumed", badge: `${Math.round(elapsed * 100)}% of year elapsed`, tone: consumed > elapsed ? "danger" : "ok" },
        { value: projected, format: "currency", label: "projected year end", tone: projected > ENG_2026_AMOUNT ? "danger" : "ok" },
      ]}
    />
  );
}
