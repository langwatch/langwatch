import { formatTimeAgo } from "../../../model/ops-formatters";
import type { OpsPipelineNode, OpsQueueGroup } from "./queue-presentation";
import type { StatusFilter } from "./queue-types";

export function isNodePaused(
  node: OpsPipelineNode,
  parentPath: string,
  pausedKeys: Set<string>,
): boolean {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (pausedKeys.has(path)) return true;
  if (parentPath) {
    const segments = parentPath.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const ancestor = segments.slice(0, i).join("/");
      if (pausedKeys.has(ancestor)) return true;
    }
  }
  return false;
}

export function isNodeDirectlyPaused(nodePath: string, pausedKeys: Set<string>): boolean {
  return pausedKeys.has(nodePath);
}

export function filterTree(nodes: OpsPipelineNode[], query: string): OpsPipelineNode[] | null {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();

  function prune(node: OpsPipelineNode): OpsPipelineNode | null {
    if (node.name.toLowerCase().includes(lower)) return node;
    const filtered = node.children.map(prune).filter((c): c is OpsPipelineNode => c !== null);
    if (filtered.length > 0) return { ...node, children: filtered };
    return null;
  }

  const result = nodes.map(prune).filter((node): node is OpsPipelineNode => node !== null);
  return result.length > 0 ? result : null;
}

export function isOverdue(ms: number | null): boolean {
  if (ms === null) return false;
  // Consider a group overdue if its oldest job is more than 5 minutes old
  return Date.now() - ms > 5 * 60 * 1000;
}

export type GroupState = "blocked" | "stale" | "retrying" | "active" | "due" | "scheduled" | "idle";

export interface GroupClassification {
  state: GroupState;
  /** Dispatch-eligibility instant, when it is in the future; null otherwise. */
  nextEligibleMs: number | null;
  /** The last attempt recorded an error a success has not yet cleared. */
  isFailing: boolean;
  /** Retries so far; 0 on a group that has never failed. */
  attempt: number;
}

/**
 * The error hash persists until a SUCCESS clears it, so an old message can
 * outlive the failure it recorded. An error only reads as "failing right now"
 * while the group is mid-retry, or while the message is recent enough that the
 * next attempt has plausibly not resolved it yet.
 */
const FAILING_ERROR_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * What a group is doing right now, from fields the scan already returns.
 *
 * The ready score is the instant the dispatcher may next pick the group up —
 * GroupQueue re-stages a failed group at `now + backoff` — so a future score
 * on a retried group IS the retry countdown, and on a fresh group it is
 * deliberate deferral. The active key alone cannot distinguish "running" from
 * "waiting out backoff" (the re-stage keeps it alive for the backoff window),
 * which is why the retry check outranks it.
 */
function hasUnclearedError(g: OpsQueueGroup, attempt: number, now: number): boolean {
  if (g.errorMessage === null) return false;
  if (attempt > 0) return true;
  return g.errorTimestamp !== null && now - g.errorTimestamp < FAILING_ERROR_MAX_AGE_MS;
}

export function classifyGroup(g: OpsQueueGroup, now = Date.now()): GroupClassification {
  const attempt = g.retryCount ?? 0;
  const isFailing = hasUnclearedError(g, attempt, now);
  const deferredUntilMs = g.score > now ? g.score : null;

  const classified = (
    state: GroupState,
    nextEligibleMs: number | null = null,
  ): GroupClassification => ({ state, nextEligibleMs, isFailing, attempt });

  if (g.isStaleBlock) return classified("stale");
  if (g.isBlocked) return classified("blocked");
  if (attempt > 0 && deferredUntilMs !== null) return classified("retrying", deferredUntilMs);
  if (g.hasActiveJob) return classified("active");
  if (g.pendingJobs > 0)
    return deferredUntilMs !== null ? classified("scheduled", deferredUntilMs) : classified("due");
  return classified("idle");
}

/** Lower = more wrong = higher in the table. */
const STATE_SEVERITY: Record<GroupState, number> = {
  blocked: 0,
  stale: 1,
  retrying: 2,
  due: 3,
  active: 4,
  scheduled: 5,
  idle: 6,
};

/**
 * Trouble first, then depth. The server orders by pending count alone, which
 * buries one blocked group under two hundred healthy fan-out rows.
 */
export function sortGroupsBySeverity<T extends OpsQueueGroup>(groups: T[], now = Date.now()): T[] {
  return [...groups].sort((a, b) => {
    const severityDelta =
      STATE_SEVERITY[classifyGroup(a, now).state] - STATE_SEVERITY[classifyGroup(b, now).state];
    if (severityDelta !== 0) return severityDelta;
    if (b.pendingJobs !== a.pendingJobs) return b.pendingJobs - a.pendingJobs;
    return a.groupId.localeCompare(b.groupId);
  });
}

/** The "Next run" cell: when the dispatcher will next touch this group. */
export function describeNextRun(c: GroupClassification, now = Date.now()): string {
  switch (c.state) {
    case "active":
      return "running";
    case "due":
      return "now";
    case "retrying":
    case "scheduled":
      // The eligibility instant can slip into the past between refreshes;
      // "in -3s" would read as a bug rather than as an imminent dispatch.
      return c.nextEligibleMs !== null && c.nextEligibleMs > now
        ? formatTimeAgo(c.nextEligibleMs, now)
        : "now";
    case "blocked":
    case "stale":
    case "idle":
      return "—";
  }
}

export function matchesStatusFilter(
  g: OpsQueueGroup,
  filter: StatusFilter,
  now = Date.now(),
): boolean {
  if (filter === "all") return true;
  const { state, isFailing } = classifyGroup(g, now);
  switch (filter) {
    case "ok":
      return !isFailing && state !== "blocked" && state !== "stale" && state !== "retrying";
    case "blocked":
      return state === "blocked";
    case "stale":
      return state === "stale";
    // "Retrying" as the operator means it: anything failing that has not yet
    // been given up on, whether it is waiting out backoff or mid-reattempt.
    case "retrying":
      return state === "retrying" || (isFailing && state !== "blocked" && state !== "stale");
    case "active":
      return state === "active";
  }
}
