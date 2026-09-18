import { DotStrip } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => {
    const medianK = Number(r.median_k) || 0;
    return {
      label: String(r.agent_type),
      meta: `${Math.round(medianK)}k median`,
      dots: (r.dots || []).map((d) => Number(d)),
      tone: medianK > 120 ? "warn" : "ok",
    };
  });

  return <DotStrip rows={rows} max={8} />;
}
