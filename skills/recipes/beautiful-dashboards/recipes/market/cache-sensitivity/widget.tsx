import { LineChart, TOKENS } from "@langwatch/charts";

// VENDOR RATE CARDS — external, fictionalized, $/1M tokens. Theoretical board.
const VENDORS = [
  { id: "current", label: "Current provider", cacheRead: 0.5, freshIn: 5, output: 25, color: TOKENS.ramp[0] },
  { id: "cheap-cache", label: "Vendor D", cacheRead: 0.022, freshIn: 0.66, output: 1.98, color: TOKENS.ramp[2] },
  { id: "k-model", label: "Vendor K", cacheRead: 0.3, freshIn: 3, output: 15, color: TOKENS.ramp[4] },
];
const HIT_RATES = [0.85, 0.9, 0.95, 0.98];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0 || !Number(data[0].input_total)) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const input = Number(data[0].input_total) || 0;
  const output = Number(data[0].output) || 0;

  const rows = HIT_RATES.map((hit) => {
    const cacheRead = input * hit;
    const fresh = input * (1 - hit);
    const row = { hit: `${Math.round(hit * 100)}%` };
    for (const v of VENDORS) {
      row[v.label] = (cacheRead * v.cacheRead + fresh * v.freshIn + output * v.output) / 1e6;
    }
    return row;
  });

  return (
    <LineChart
      data={rows}
      x="hit"
      format="currency"
      series={VENDORS.map((v) => ({ key: v.label, label: v.label, color: v.color, width: 2 }))}
      legend
    />
  );
}
