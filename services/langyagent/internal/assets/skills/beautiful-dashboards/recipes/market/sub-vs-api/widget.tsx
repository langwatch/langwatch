import { LineChart, formatValue, TOKENS } from "@langwatch/charts";

export default function Widget() {
  const total = LW.useChartQuery("total", {});
  const daily = LW.useChartQuery("daily", {});
  if (total.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{total.error.message}</div>;
  if (total.isLoading || total.data === null || daily.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (daily.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const listCost = Number(total.data[0]?.list_cost) || 0;
  const rows = daily.data.map((r) => ({ day: String(r.day).slice(5, 10), "list price": Number(r.cost) }));

  return (
    <div style={{ height: "100%" }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <strong>{formatValue(listCost, "currency")}</strong> <span style={{ color: TOKENS.muted }}>at API list prices, last 30 days</span>
      </div>
      <LineChart data={rows} x="day" format="currency" series={[{ key: "list price", label: "list price", color: TOKENS.ramp[0], width: 2 }]} />
    </div>
  );
}
