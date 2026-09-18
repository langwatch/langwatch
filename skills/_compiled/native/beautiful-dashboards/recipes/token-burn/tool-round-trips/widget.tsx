import { RankedList, formatValue } from "@langwatch/charts";

const USD_PER_TOKEN = 3 / 1e6; // rough mid-tier input rate; bytes/4 ≈ tokens

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;

  const rows = data.map((r) => {
    const payloadK = Math.round(Number(r.max_bytes) / 4 / 1000);
    const estUsd = (Number(r.total_bytes) / 4) * USD_PER_TOKEN;
    return {
      title: String(r.tool),
      sub: `${payloadK}k tokens per call · ${r.times}x this week`,
      value: estUsd,
      format: "currency",
    };
  });

  return <RankedList rows={rows} max={5} />;
}
