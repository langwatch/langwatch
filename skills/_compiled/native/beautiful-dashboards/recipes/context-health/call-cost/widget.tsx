import { BarList, TOKENS } from "@langwatch/charts";

const ORDER = ["0-100k", "100-200k", "200-400k", "400k+"];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const total = data.reduce((s, r) => s + Number(r.calls), 0) || 1;
  const byBand = {};
  for (const r of data) byBand[String(r.band)] = r;
  const rows = ORDER.filter((b) => byBand[b]).map((b) => {
    const r = byBand[b];
    return { label: b, sub: `${Math.round((Number(r.calls) / total) * 100)}% of calls`, value: Number(r.avg_cost), color: TOKENS.ramp[0] };
  });

  return <BarList rows={rows} format="currency" showValue max={4} />;
}
