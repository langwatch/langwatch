import { Gantt, fixedColor } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No sessions ran today yet.</div>;

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const dayStart = midnight.getTime() / 1000;

  const rows = data.map((r) => {
    const start = Number(r.start_s);
    const active = Number(r.active_sec) || 0;
    const blocked = Number(r.blocked_sec) || 0;
    const activeEnd = start + active;
    const segments = [{ start: (start - dayStart) / 3600, end: (activeEnd - dayStart) / 3600, kind: "active" }];
    if (blocked > 0) {
      segments.push({ start: (activeEnd - dayStart) / 3600, end: (activeEnd + blocked - dayStart) / 3600, kind: "idle" });
    }
    return { label: String(r.label || "Untitled"), sub: String(r.repo || ""), color: fixedColor(String(r.repo || "session")), segments };
  });

  const ticks = [0, 6, 12, 18, 24].map((at) => ({ at, label: `${at}:00` }));
  return <Gantt rows={rows} rangeStart={0} rangeEnd={24} ticks={ticks} />;
}
