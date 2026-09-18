import { RankedList, Badge, formatValue } from "@langwatch/charts";

function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No pull requests in this window yet.</div>;

  const med = median(data.map((r) => Number(r.cost)));
  const rows = data.map((r) => {
    const cost = Number(r.cost);
    const hot = med > 0 && cost > 3 * med;
    return {
      title: `#${r.pr} ${String(r.title || "").slice(0, 40)}`,
      sub: `${r.repo} · ${r.state} · ${r.sessions} sessions · ${formatValue(Number(r.tokens), "tokens")} tokens`,
      value: cost,
      format: "currency",
      badge: hot ? `${(cost / med).toFixed(1)}x median` : undefined,
    };
  });

  return <RankedList rows={rows} max={6} />;
}
