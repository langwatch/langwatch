import { LineChart, Badge, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const week = LW.useChartQuery("this_week", {});
  const typ = LW.useChartQuery("typical", {});
  if (week.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{week.error.message}</div>;
  if (week.isLoading || week.data === null || typ.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (week.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const typByDow = {};
  for (const t of typ.data) typByDow[Number(t.dow)] = t;

  let cum = 0, typCum = 0;
  const rows = week.data.map((r) => {
    const dow = new Date(String(r.day)).getUTCDay() || 7;
    const t = typByDow[dow] || {};
    cum += Number(r.cost);
    typCum += Number(t.typical) || 0;
    return {
      day: String(r.day).slice(5, 10),
      thisWeek: cum,
      typical: typCum,
      low: typCum - (Number(t.low) || 0) * 0.3,
      high: typCum + (Number(t.high) || 0) * 0.3,
      rateLimit: Number(r.rate_limited) > 0 ? cum : null,
    };
  });
  const now = cum;
  const deltaPct = typCum > 0 ? ((now - typCum) / typCum) * 100 : 0;

  return (
    <div style={{ height: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{"$" + now.toFixed(0)}</span>
        <span style={{ fontSize: 11, color: TOKENS.muted }}>in the last 7 days</span>
        <Badge text={`${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct)}% vs your typical week`} tone={deltaPct > 15 ? "warn" : "ok"} />
      </div>
      <LineChart
        data={rows}
        x="day"
        format="currency"
        band={{ lowKey: "low", highKey: "high" }}
        series={[
          { key: "typical", label: "typical week", color: TOKENS.faint, dashed: true },
          { key: "thisWeek", label: "this week", color: TOKENS.ramp[0], width: 2 },
        ]}
        legend
      />
    </div>
  );
}
