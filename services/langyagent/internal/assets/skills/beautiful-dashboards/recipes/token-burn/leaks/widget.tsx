import { BarList, Badge, formatValue, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const ctx = LW.useChartQuery("big_context", {});
  const retries = LW.useChartQuery("retries", {});
  const tools = LW.useChartQuery("oversized_tools", {});
  const rebuilds = LW.useChartQuery("rebuilds", {});
  const all = [ctx, retries, tools, rebuilds];
  if (all.some((q) => q.isError)) return <div style={{ fontSize: 11, color: "#b00" }}>{all.find((q) => q.isError).error.message}</div>;
  if (all.some((q) => q.isLoading || q.data === null)) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (all.every((q) => q.data.length === 0)) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const c = ctx.data[0] || {};
  const rt = retries.data[0] || {};
  const t = tools.data[0] || {};
  const rb = rebuilds.data[0] || {};
  const rebuildCost = (Number(rb.largest) || 0) / 1e6 * 0.3; // largest rebuild repriced

  const rows = [
    { label: "Sessions past 600k context", sub: `${c.sessions || 0} sessions, peaked at ${formatValue(Number(c.peak) || 0, "tokens")}`, value: Number(c.cost) || 0, meta: "measured", color: TOKENS.danger },
    { label: "Retried calls", sub: `${rt.retries || 0} retries, ${Math.round(Number(rt.minutes_lost) || 0)} min lost`, value: 0, meta: "measured", color: TOKENS.warn },
    { label: "Oversized tool results", sub: `${t.results || 0} results across ${t.tools || 0} tools`, value: Number(t.cost) || 0, meta: "estimated", color: TOKENS.warn },
    { label: "Cache rebuilt mid-session", sub: `${rb.rebuilds || 0} rebuilds, largest ${formatValue(Number(rb.largest) || 0, "tokens")}`, value: rebuildCost, meta: "estimated", color: TOKENS.warn },
  ].sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div style={{ height: "100%" }}>
      <BarList rows={rows} format="currency" showValue max={4} />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}>
        <Badge text={`≈${formatValue(total, "currency")}/week recoverable`} tone="warn" />
      </div>
    </div>
  );
}
