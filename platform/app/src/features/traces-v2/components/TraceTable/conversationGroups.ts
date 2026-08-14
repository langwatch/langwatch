import type { TraceListItem, TraceStatus } from "../../types/trace";

export interface ConversationGroup {
  conversationId: string;
  /**
   * The turn rows shown when the session is expanded. Server-grouped session
   * rows start empty and lazily fill on expand; `traceCount` below carries
   * the TRUE total either way, so never read `traces.length` for totals.
   */
  traces: TraceListItem[];
  /** True number of traces in the session across the whole time range. */
  traceCount: number;
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
  /**
   * The conversation's most recent trace, the one a click on the row opens.
   * Server rows carry the field but its value is null when the rollup named no
   * trace; page-local groups built client-side (sample preview) and skeleton
   * rows leave it out entirely. A row without one expands on click instead.
   */
  lastTraceId?: string | null;
  latestTimestamp: number;
  earliestTimestamp: number;
  lastMessage: string;
  lastOutput: string;
  primaryModel: string;
  serviceName: string;
  /**
   * Server-rollup extras (specs/traces-v2/sessions-lens.feature). Absent on
   * page-local groups built client-side (sample preview) and on skeletons.
   */
  contextSizeTokens?: number | null;
  /** Pre-folded coding-agent counters; null when the session has no coding-agent row. */
  modelCalls?: number | null;
  compactions?: number | null;
  /**
   * Where the session ran, and what the agent called it. Null when nothing
   * reported it; `title` is also null when the viewer may not read captured
   * content, which `titleRedacted` is what tells apart.
   */
  repositoryHost?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  gitBranch?: string | null;
  gitWorktree?: string | null;
  title?: string | null;
  titleRedacted?: boolean;
  /**
   * The pull request this session's work belongs to, decided server-side from
   * the branch's pull-request history. Null when the session has no git
   * context, the repository is not connected, or the branch has no pull
   * request yet.
   */
  pullRequest?: ConversationPullRequest | null;
}

/** Identity only: the number, where it lives, and what it is called. */
export interface ConversationPullRequest {
  number: number;
  htmlUrl: string;
  title: string;
}

/** Evaluation outcomes summed across one conversation's traces. */
function tallyEvaluations(traces: TraceListItem[]): {
  totalEvals: number;
  evalsPassedCount: number;
  evalsFailedCount: number;
} {
  let totalEvals = 0;
  let evalsPassedCount = 0;
  let evalsFailedCount = 0;
  for (const t of traces) {
    for (const ev of t.evaluations) {
      totalEvals++;
      if (ev.passed === true) evalsPassedCount++;
      else if (ev.passed === false) evalsFailedCount++;
    }
  }
  return { totalEvals, evalsPassedCount, evalsFailedCount };
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
    for (const t of sorted) {
      totalSpans += t.spanCount;
      if (t.status === "error") errorCount++;
      totalEvents += t.events.totalCount;
    }

    const lastOutput =
      [...sorted].reverse().find((t) => t.output)?.output ?? "";

    result.push({
      conversationId: id,
      traces: sorted,
      traceCount: sorted.length,
      totalDuration: sorted.reduce((s, t) => s + t.durationMs, 0),
      totalCost: sorted.reduce((s, t) => s + t.totalCost, 0),
      totalTokens: sorted.reduce((s, t) => s + t.totalTokens, 0),
      totalSpans,
      errorCount,
      totalEvents,
      ...tallyEvaluations(sorted),
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
  turns: (g) => g.traceCount,
  started: (g) => g.earliestTimestamp,
  lastTurn: (g) => g.latestTimestamp,
};

/**
 * Order conversation groups by the active lens sort, using the per-group
 * aggregates. The conversation table renders with `manualSorting`, so the
 * order it shows is whatever we return here.
 *
 * Only the onboarding sample-preview path still comes through here: real
 * data uses the server-side session rollup, which sorts and paginates in
 * ClickHouse (specs/traces-v2/sessions-lens.feature). Sample preview groups
 * the fixture page client-side, so it keeps needing a local sort.
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
