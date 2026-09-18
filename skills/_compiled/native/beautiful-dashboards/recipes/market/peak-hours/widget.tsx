import { LineChart, formatValue, TOKENS } from "@langwatch/charts";

// Vendor peak-pricing windows (UTC hour ranges) — external metadata.
const PEAK_WINDOWS = [{ from: 1, to: 4 }, { from: 6, to: 10 }];

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No tokens today yet.</div>;

  const byHour = {};
  let total = 0, peak = 0;
  for (const r of data) {
    const h = Number(r.hour);
    const tk = Number(r.tokens);
    byHour[h] = tk;
    total += tk;
    if (PEAK_WINDOWS.some((w) => h >= w.from && h < w.to)) peak += tk;
  }
  const rows = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, tokens: byHour[h] || 0 }));
  const pct = total > 0 ? peak / total : 0;

  return (
    <div style={{ height: "100%" }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <strong>{formatValue(pct, "percent")}</strong> <span style={{ color: TOKENS.muted }}>of today's tokens in peak windows</span>
      </div>
      <LineChart
        data={rows}
        x="hour"
        format="tokens"
        series={[{ key: "tokens", label: "tokens", color: TOKENS.ramp[0], width: 2 }]}
        referenceAreas={PEAK_WINDOWS.map((w) => ({ x1: `${w.from}:00`, x2: `${w.to}:00`, label: "peak", color: TOKENS.danger, opacity: 0.07 }))}
      />
    </div>
  );
}
