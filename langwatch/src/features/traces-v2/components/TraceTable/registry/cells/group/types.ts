import type { TraceListItem, TraceStatus } from "../../../../../types/trace";

export type GroupBy = "service" | "model" | "user";

export interface TraceGroup {
  key: string;
  label: string;
  traces: TraceListItem[];
  avgDuration: number;
  totalCost: number;
  totalTokens: number;
  errorCount: number;
  worstStatus: TraceStatus;
  groupBy: GroupBy;
  index: number;
}

export const GROUP_DOT_COLORS = [
  "blue.400",
  "green.400",
  "purple.400",
  "orange.400",
  "cyan.400",
  "pink.400",
  "teal.400",
  "yellow.400",
] as const;

export function dotColorForIndex(index: number): string {
  return GROUP_DOT_COLORS[index % GROUP_DOT_COLORS.length]!;
}

export function extractGroupKey(
  trace: TraceListItem,
  groupBy: GroupBy,
): string {
  switch (groupBy) {
    case "service":
      return trace.serviceName || "(unknown)";
    case "model":
      return trace.models[0] ?? "(unknown)";
    case "user":
      return trace.userId ?? "(unknown)";
  }
}

export function buildGroups(
  traces: TraceListItem[],
  groupBy: GroupBy,
): TraceGroup[] {
  const map = new Map<string, TraceListItem[]>();

  for (const trace of traces) {
    const key = extractGroupKey(trace, groupBy);
    const list = map.get(key) ?? [];
    list.push(trace);
    map.set(key, list);
  }

  const groups: TraceGroup[] = [];
  let index = 0;

  for (const [key, groupTraces] of map) {
    const sorted = groupTraces.sort((a, b) => b.timestamp - a.timestamp);
    const totalDuration = sorted.reduce((sum, t) => sum + t.durationMs, 0);
    const errorCount = sorted.filter((t) => t.status === "error").length;

    let worstStatus: TraceStatus = "ok";
    for (const t of sorted) {
      if (t.status === "error") {
        worstStatus = "error";
        break;
      }
      if (t.status === "warning") worstStatus = "warning";
    }

    groups.push({
      key,
      label: key,
      traces: sorted,
      avgDuration: totalDuration / sorted.length,
      totalCost: sorted.reduce((sum, t) => sum + t.totalCost, 0),
      totalTokens: sorted.reduce((sum, t) => sum + t.totalTokens, 0),
      errorCount,
      worstStatus,
      groupBy,
      index: index++,
    });
  }

  return groups;
}
