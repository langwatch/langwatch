import { BarList, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const r = data[0];
  const caps = [
    { cap: 200, calls: Number(r.calls_200) || 0, tokens: Number(r.tokens_200) || 0 },
    { cap: 256, calls: Number(r.calls_256) || 0, tokens: Number(r.tokens_256) || 0 },
    { cap: 500, calls: Number(r.calls_500) || 0, tokens: Number(r.tokens_500) || 0 },
  ];
  const rows = caps.map((c) => ({
    label: `above ${c.cap}k context`,
    sub: `${c.calls.toFixed(1)}% of calls · ${c.tokens.toFixed(1)}% of tokens`,
    value: c.tokens / 100,
    color: TOKENS.warn,
  }));

  return <BarList rows={rows} format="percent" showValue={false} max={3} />;
}
