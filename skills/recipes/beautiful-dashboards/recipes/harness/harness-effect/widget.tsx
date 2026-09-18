import { BarList, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const per = LW.useChartQuery("per_skill", {});
  const g = LW.useChartQuery("global", {});
  if (per.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{per.error.message}</div>;
  if (per.isLoading || per.data === null || g.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (per.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const globalAvg = Number(g.data[0]?.avg_tokens) || 0;
  const rows = per.data.map((r) => {
    const withAvg = Number(r.with_avg);
    const deltaPct = globalAvg > 0 ? ((withAvg - globalAvg) / globalAvg) * 100 : 0;
    const saves = deltaPct < 0;
    return {
      label: String(r.skill),
      sub: `n = ${r.n_with} sessions · ${saves ? "fewer" : "more"} tokens vs your average`,
      value: Math.abs(deltaPct),
      meta: `${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct)}%`,
      color: saves ? TOKENS.ok : TOKENS.danger,
      tone: saves ? "ok" : "danger",
    };
  });

  return <BarList rows={rows} format="percent" max={8} showValue={false} />;
}
