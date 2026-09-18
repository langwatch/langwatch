import { BarList, TOKENS } from "@langwatch/charts";

// VENDOR RATE CARDS — external, fictionalized public pricing, $/1M tokens.
// This board is theoretical: prices only, no quality adjustment.
const VENDORS = [
  { id: "current", name: "Current provider", freshIn: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25, current: true },
  { id: "vendor-d", name: "Vendor D (off-peak)", freshIn: 0.66, cacheRead: 0.022, cacheWrite: 0.66, output: 1.98, note: "peak hours double it" },
  { id: "vendor-k", name: "Vendor K", freshIn: 3, cacheRead: 0.3, cacheWrite: 3, output: 15 },
  { id: "vendor-g", name: "Vendor G (flash)", freshIn: 0.75, cacheRead: 0.19, cacheWrite: 0.75, output: 3.75, note: "intro pricing" },
  { id: "vendor-x", name: "Vendor X", freshIn: 2, cacheRead: 0.5, cacheWrite: 2, output: 6, note: "prices double past 200k" },
];

function replayCost(v, t) {
  return (t.fresh * v.freshIn + t.cache_read * v.cacheRead + t.cache_write * v.cacheWrite + t.output * v.output) / 1e6;
}

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0 || !Number(data[0].fresh)) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const t = {
    fresh: Number(data[0].fresh) || 0,
    cache_read: Number(data[0].cache_read) || 0,
    cache_write: Number(data[0].cache_write) || 0,
    output: Number(data[0].output) || 0,
  };
  const rows = VENDORS.map((v) => ({
    label: v.name,
    sub: v.current ? "you are here" : v.note || "",
    value: replayCost(v, t),
    color: v.current ? TOKENS.faint : TOKENS.ramp[0],
  })).sort((a, b) => a.value - b.value);

  return <BarList rows={rows} format="currency" showValue max={5} />;
}
