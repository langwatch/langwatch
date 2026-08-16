import { createLogger } from "@langwatch/observability";

const logger = createLogger(
  "langwatch:coding-agent-processing:session-seen-touch",
);

/**
 * How long one process holds off repeating a project's touch.
 *
 * Five minutes, because nothing downstream reads the moment: the column feeds
 * a recency window measured in days, and the sidebar that renders it is read
 * on a page load, not a poll. The window only has to keep a busy session's
 * fold commits from probing Postgres on every batch; the write behind it is
 * rate limited again at the service (the one-hour staleness guard), so a probe
 * that does go through usually updates nothing.
 */
export const CODING_AGENT_SESSION_SEEN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Entries kept in the per-process window map before expired ones are swept.
 * The map holds one entry per project this worker folded recently; the sweep
 * only exists so a long-lived worker cannot grow it without bound.
 */
const WINDOW_MAP_SWEEP_THRESHOLD = 10_000;

/** What the touch needs to record the project's activity. */
export interface CodingAgentSessionSeenTouchDeps {
  touchCodingAgentSessionSeen(params: {
    projectId: string;
    at: Date;
  }): Promise<void>;
  /** Injectable clock for the window tests. */
  now?: () => number;
}

/**
 * The inline stamp that records, on the project, that a coding-agent session
 * folded — which is what puts the Sessions destination in the project's
 * sidebar. Called by the session fold store after a commit, the same seam the
 * gateway spend pipeline advances virtual-key `lastUsedAt` on: a throttled
 * write where the fact becomes true, with no queue job behind it.
 *
 * Every error is logged and swallowed, and the returned promise never
 * rejects. The session row is already committed; a failed touch costs one
 * menu link until the project's next fold re-asserts it.
 *
 * The window map is per process. Several workers each probing once per window
 * is fine: the service's staleness guard makes the extra probes no-op
 * updates, so the map only exists to keep one hot session from probing
 * Postgres on every fold commit.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
export function createCodingAgentSessionSeenTouch(
  deps: CodingAgentSessionSeenTouchDeps,
): (tenantIds: Iterable<string>) => Promise<void> {
  const now = deps.now ?? Date.now;
  const heldUntil = new Map<string, number>();

  return async (tenantIds: Iterable<string>): Promise<void> => {
    const at = now();
    if (heldUntil.size >= WINDOW_MAP_SWEEP_THRESHOLD) {
      sweepExpiredHolds({ heldUntil, at });
    }
    const due = claimDueProjects({ heldUntil, tenantIds, at });
    await Promise.all(
      due.map((projectId) => touchProject({ deps, heldUntil, projectId, at })),
    );
  };
}

function sweepExpiredHolds({
  heldUntil,
  at,
}: {
  heldUntil: Map<string, number>;
  at: number;
}): void {
  for (const [key, until] of heldUntil) {
    if (until <= at) heldUntil.delete(key);
  }
}

/** Claim a fresh window for every project not already inside one. */
function claimDueProjects({
  heldUntil,
  tenantIds,
  at,
}: {
  heldUntil: Map<string, number>;
  tenantIds: Iterable<string>;
  at: number;
}): string[] {
  const due: string[] = [];
  for (const tenantId of new Set(tenantIds)) {
    if ((heldUntil.get(tenantId) ?? 0) > at) continue;
    heldUntil.set(tenantId, at + CODING_AGENT_SESSION_SEEN_WINDOW_MS);
    due.push(tenantId);
  }
  return due;
}

async function touchProject({
  deps,
  heldUntil,
  projectId,
  at,
}: {
  deps: CodingAgentSessionSeenTouchDeps;
  heldUntil: Map<string, number>;
  projectId: string;
  at: number;
}): Promise<void> {
  const holdSetTo = at + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
  try {
    await deps.touchCodingAgentSessionSeen({ projectId, at: new Date(at) });
  } catch (error) {
    // Release the hold so the NEXT commit retries, instead of the failure
    // quietly extending into a full window of silence — but only the hold
    // THIS call placed. A slow write failing after its window has expired
    // must not drop the hold a newer call already took.
    if (heldUntil.get(projectId) === holdSetTo) {
      heldUntil.delete(projectId);
    }
    logger.warn(
      { error, tenantId: projectId },
      "recording the project's coding-agent session activity failed, non-fatal, the next fold retries it",
    );
  }
}
