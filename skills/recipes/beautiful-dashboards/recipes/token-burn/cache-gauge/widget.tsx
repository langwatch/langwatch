import { Gauge, RankedList, Badge, formatValue, TOKENS } from "@langwatch/charts";

function zone(hit) {
  if (hit >= 0.9) return { tone: "ok", verdict: "healthy" };
  if (hit >= 0.6) return { tone: "warn", verdict: "getting expensive" };
  return { tone: "danger", verdict: "caching is not working" };
}

export default function Widget() {
  const overall = LW.useChartQuery("overall", {});
  const per = LW.useChartQuery("per_session", {});
  if (overall.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{overall.error.message}</div>;
  if (overall.isLoading || overall.data === null || per.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (overall.data.length === 0 || overall.data[0].hit_rate === null) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const hit = Number(overall.data[0].hit_rate) || 0;
  const z = zone(hit);
  const sessions = per.data.map((r) => ({
    title: String(r.title || "Untitled"),
    sub: `${formatValue(Number(r.hit), "percent")} cached · ${formatValue(Number(r.cost), "currency")}`,
    value: Number(r.hit),
    format: "percent",
  }));
  const mostCached = sessions.slice(0, 3);
  const leastCached = sessions.slice(-3).reverse();

  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      <div style={{ flex: "0 0 40%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Gauge
          value={hit}
          zones={[{ from: 0, to: 0.6, color: TOKENS.danger }, { from: 0.6, to: 0.9, color: TOKENS.warn }, { from: 0.9, to: 1, color: TOKENS.ok }]}
          label="cache hit rate"
        />
        <Badge text={z.verdict} tone={z.tone} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: TOKENS.muted, textTransform: "uppercase" }}>Most cached</div>
        <RankedList rows={mostCached} max={3} />
        <div style={{ fontSize: 10, color: TOKENS.muted, textTransform: "uppercase" }}>Least cached</div>
        <RankedList rows={leastCached} max={3} />
      </div>
    </div>
  );
}
