import { BarList, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => {
    const linked = r.pr !== "none";
    return {
      label: linked ? `#${r.pr} ${String(r.title || "").slice(0, 40)}` : "No pull request",
      sub: linked ? String(r.repo || "") : "exploration, chores, babysitting",
      value: Number(r.cost),
      color: linked ? TOKENS.ramp[0] : TOKENS.faint,
    };
  });

  return <BarList rows={rows} format="currency" showValue max={6} />;
}
