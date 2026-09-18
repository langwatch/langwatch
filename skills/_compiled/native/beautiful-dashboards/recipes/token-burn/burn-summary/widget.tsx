import { StatTiles, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const r = data[0];
  const week = Number(r.week_cost) || 0;
  const prior = Number(r.prior_week_cost) || 0;
  const deltaPct = prior > 0 ? ((week - prior) / prior) * 100 : 0;
  const paceBadge = prior > 0 ? `${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct)}% vs typical` : "no prior week";
  const paceTone = deltaPct > 15 ? "warn" : "ok";

  return (
    <StatTiles
      divided
      tiles={[
        { value: Number(r.cost), format: "currency", label: "spent", sub: "in the period" },
        { value: Number(r.total_tokens), format: "tokens", label: "tokens", sub: "in the period" },
        { value: week, format: "currency", label: "this week's pace", badge: paceBadge, tone: paceTone },
        { value: Number(r.rate_limited), format: "number", label: "rate limited", sub: "this week", tone: Number(r.rate_limited) > 0 ? "warn" : undefined },
      ]}
    />
  );
}
