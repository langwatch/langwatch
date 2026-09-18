import { Bars, TOKENS } from "@langwatch/charts";

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
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No merged pull requests in this window yet.</div>;

  const med = median(data.map((r) => Number(r.cost)));
  const rows = data.map((r) => ({ pr: `#${r.pr}`, cost: Number(r.cost), tone: Number(r.cost) > 3 * med ? "danger" : "accent" }));

  return (
    <Bars
      data={rows}
      x="pr"
      y="cost"
      colorBy={(row) => (row.tone === "danger" ? TOKENS.danger : TOKENS.ramp[0])}
      format="currency"
      referenceLines={[
        { y: med, label: "median", color: TOKENS.faint, dashed: true },
        { y: 3 * med, label: "3x median", color: TOKENS.danger, dashed: true },
      ]}
    />
  );
}
