import { Bars, formatValue, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const total = data.reduce((s, r) => s + Number(r.usd), 0);
  const rows = data.map((r) => ({ day: String(r.day).slice(5, 10), "above 450k": Number(r.usd) }));

  return (
    <div style={{ height: "100%" }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <strong>{formatValue(total, "currency")}</strong> <span style={{ color: TOKENS.muted }}>in the period</span>
      </div>
      <Bars data={rows} x="day" y="above 450k" format="currency" />
    </div>
  );
}
