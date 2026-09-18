import { StatTiles } from "@langwatch/charts";

export default function Widget() {
  const main = LW.useChartQuery("main", {});
  const genie = LW.useChartQuery("genie", {});
  if (main.isError) return <div style={{ fontSize: 11, color: "#b00" }}>{main.error.message}</div>;
  if (main.isLoading || main.data === null || genie.data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (main.data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No usage recorded for this department yet.</div>;

  const r = main.data[0];
  const g = genie.data[0] || {};
  const conversations = Number(g.conversations) || 0;
  const perConversation = conversations > 0 ? Number(g.compute) / conversations : 0;

  return (
    <StatTiles
      divided
      tiles={[
        { value: Number(r.total_cost), format: "currency", label: "Engineering AI cost", sub: "seats, tokens and cloud" },
        { value: Number(r.users), format: "number", label: "people using AI" },
        { value: Number(r.interactions), format: "number", label: "interactions" },
        { value: perConversation, format: "currency", label: "compute per question", sub: "allocated, never billed" },
      ]}
    />
  );
}
