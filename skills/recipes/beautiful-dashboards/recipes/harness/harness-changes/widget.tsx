import { RankedList, Badge } from "@langwatch/charts";

export default function Widget() {
  const now = LW.useChartQuery("this_week", {});
  const prior = LW.useChartQuery("prior_week", {});
  if (now.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{now.error.message}</div>;
  if (now.isLoading || now.data === null || prior.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;

  const nowBy = {}, priorBy = {};
  for (const r of now.data) nowBy[String(r.skill)] = Number(r.n);
  for (const r of prior.data) priorBy[String(r.skill)] = Number(r.n);
  const names = Array.from(new Set([...Object.keys(nowBy), ...Object.keys(priorBy)]));

  const changed = [];
  for (const name of names) {
    const a = nowBy[name] || 0, b = priorBy[name] || 0;
    if (a === b) continue;
    let badge = "up", tone = "warn";
    if (b === 0) { badge = "new"; tone = "ok"; }
    else if (a === 0) { badge = "gone"; tone = "danger"; }
    else if (a < b) { badge = "down"; tone = "warn"; }
    const pct = b > 0 ? Math.round(((a - b) / b) * 100) : 0;
    changed.push({ title: name, sub: b === 0 ? `${a} invocations this week` : a === 0 ? "no calls this week" : `${pct >= 0 ? "+" : ""}${pct}% week over week`, value: a, format: "number", badge, tone });
  }
  changed.sort((x, y) => y.value - x.value);
  if (changed.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>Nothing changed in your harness this week.</div>;

  return <RankedList rows={changed} max={6} />;
}
