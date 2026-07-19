import type { TraceListItem, TraceStatus } from "../../types/trace";

export interface ConversationGroup {
  conversationId: string;
  traces: TraceListItem[];
  totalDuration: number;
  totalCost: number;
  totalTokens: number;
  totalSpans: number;
  errorCount: number;
  totalEvents: number;
  totalEvals: number;
  evalsPassedCount: number;
  evalsFailedCount: number;
  worstStatus: TraceStatus;
  latestTimestamp: number;
  earliestTimestamp: number;
  lastMessage: string;
  lastOutput: string;
  primaryModel: string;
  serviceName: string;
}

export function groupTracesByConversation(
  traces: TraceListItem[],
): ConversationGroup[] {
  const map = new Map<string, TraceListItem[]>();
  for (const t of traces) {
    if (!t.conversationId) continue;
    const list = map.get(t.conversationId) ?? [];
    list.push(t);
    map.set(t.conversationId, list);
  }

  const result: ConversationGroup[] = [];
  for (const [id, groupTraces] of map) {
    const sorted = groupTraces.sort((a, b) => a.timestamp - b.timestamp);
    const lastTrace = sorted[sorted.length - 1]!;
    const firstTrace = sorted[0]!;

    const modelCounts = new Map<string, number>();
    for (const t of sorted) {
      for (const m of t.models) {
        modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
      }
    }
    const primaryModel =
      [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    const services = new Set(sorted.map((t) => t.serviceName).filter(Boolean));

    let worstStatus: TraceStatus = "ok";
    for (const t of sorted) {
      if (t.status === "error") {
        worstStatus = "error";
        break;
      }
      if (t.status === "warning") worstStatus = "warning";
    }

    let totalSpans = 0;
    let errorCount = 0;
    let totalEvents = 0;
    let totalEvals = 0;
    let evalsPassedCount = 0;
    let evalsFailedCount = 0;
    for (const t of sorted) {
      totalSpans += t.spanCount;
      if (t.status === "error") errorCount++;
      totalEvents += t.events.length;
      totalEvals += t.evaluations.length;
      for (const ev of t.evaluations) {
        if (ev.passed === true) evalsPassedCount++;
        else if (ev.passed === false) evalsFailedCount++;
      }
    }

    const lastOutput =
      [...sorted].reverse().find((t) => t.output)?.output ?? "";

    result.push({
      conversationId: id,
      traces: sorted,
      totalDuration: sorted.reduce((s, t) => s + t.durationMs, 0),
      totalCost: sorted.reduce((s, t) => s + t.totalCost, 0),
      totalTokens: sorted.reduce((s, t) => s + t.totalTokens, 0),
      totalSpans,
      errorCount,
      totalEvents,
      totalEvals,
      evalsPassedCount,
      evalsFailedCount,
      worstStatus,
      latestTimestamp: lastTrace.timestamp,
      earliestTimestamp: firstTrace.timestamp,
      lastMessage: lastTrace.input ?? lastTrace.output ?? "",
      lastOutput,
      primaryModel,
      serviceName: services.size === 1 ? [...services][0]! : "",
    });
  }

  return result.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}

/**
 * Per-group numeric accessors for the dimensions a lens can sort
 * conversations by. Anything not here keeps the latest-first default.
 */
const GROUP_SORT_ACCESSORS: Record<string, (g: ConversationGroup) => number> = {
  cost: (g) => g.totalCost,
  tokens: (g) => g.totalTokens,
  duration: (g) => g.totalDuration,
  turns: (g) => g.traces.length,
  started: (g) => g.earliestTimestamp,
  lastTurn: (g) => g.latestTimestamp,
};

/**
 * Order conversation groups by the active lens sort, using the per-group
 * aggregates. The conversation table renders with `manualSorting`, so the
 * order it shows is whatever we return here — without this, groups always
 * fell back to latest-first regardless of the lens (e.g. "Expensive
 * Conversations" didn't actually lead with the costliest, and "Longest
 * Conversations" / "Token-Heavy Conversations" couldn't sort at all, since
 * turn-count and group-total tokens aren't trace-level sort columns).
 *
 * Note: grouping is page-local — this orders the conversations within the
 * fetched page, not globally across all data. See
 * specs/traces-v2/lens-preset-groups.feature
 */
export function sortConversationGroups({
  groups,
  sort,
}: {
  groups: ConversationGroup[];
  sort: { columnId: string; direction: "asc" | "desc" };
}): ConversationGroup[] {
  const accessor = GROUP_SORT_ACCESSORS[sort.columnId];
  if (!accessor) return groups;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => (accessor(a) - accessor(b)) * dir);
}
