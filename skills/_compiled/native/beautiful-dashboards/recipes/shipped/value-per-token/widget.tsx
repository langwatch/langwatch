import { StatTiles } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0 || !Number(data[0].prs)) return <div style={{ fontSize: 11, color: "#666" }}>No merged pull requests in this window yet.</div>;

  const r = data[0];
  return (
    <StatTiles
      tiles={[
        { value: Number(r.avg_cost), format: "currency", label: "assistant cost per merged pull request" },
        { value: Number(r.avg_tokens), format: "tokens", label: "per merged pull request" },
        { value: Number(r.prs), format: "number", label: "pull requests merged", sub: "in the period" },
        { value: Number(r.sessions_per_pr), format: "number", label: "sessions per merged pull request" },
      ]}
    />
  );
}
