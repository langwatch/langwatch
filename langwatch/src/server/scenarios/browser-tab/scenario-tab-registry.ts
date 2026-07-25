import { createLogger } from "@langwatch/observability";
import { connection } from "~/server/redis";

const logger = createLogger("langwatch:scenario-tab-registry");

const KEY_PREFIX = "scenario_tab:v1";

/**
 * How long a registration survives without a refresh. The SSE subscription
 * refreshes on {@link SCENARIO_TAB_REFRESH_MS}, so this only runs out when the
 * browser is really gone (closed tab, killed process, sleeping laptop).
 */
export const SCENARIO_TAB_TTL_SECONDS = 30;

/** Server-side refresh cadence, comfortably inside the TTL. */
export const SCENARIO_TAB_REFRESH_MS = 10_000;

/**
 * How long a tab stays claimable after its subscription ends.
 *
 * A tab drops its subscription for reasons that have nothing to do with going
 * away: it routes to another run (including the run this very feature just
 * handed it), the project context re-resolves, the dev server hot-reloads. With
 * an instant de-registration, the run right after a followed run would find no
 * tab and open a new one — the exact thing this exists to prevent. A few
 * seconds of grace covers every one of those, while a genuinely closed tab
 * still stops taking runs almost immediately.
 */
export const SCENARIO_TAB_DISCONNECT_GRACE_SECONDS = 5;

/**
 * How long a handed-off run stays claimable by a tab that was not connected at
 * the moment it was broadcast — a reload, a route change, a laptop waking up.
 * Short enough that a tab opened much later does not jump to a stale run.
 */
export const SCENARIO_TAB_PENDING_TTL_SECONDS = 20;

function tabSetKey(projectId: string, tabKey: string): string {
  return `${KEY_PREFIX}:${projectId}:${tabKey}`;
}

function pendingKey(projectId: string, tabKey: string): string {
  return `${KEY_PREFIX}:pending:${projectId}:${tabKey}`;
}

/**
 * In-process stand-in used when Redis is not configured. A deployment without
 * Redis is single-instance by definition, so a module-level map sees every
 * subscription the same way Redis would.
 */
const memoryTabs = new Map<string, Map<string, number>>();
const memoryPending = new Map<string, { url: string; expiresAt: number }>();

function memoryEntry(key: string): Map<string, number> {
  let entry = memoryTabs.get(key);
  if (!entry) {
    entry = new Map();
    memoryTabs.set(key, entry);
  }
  return entry;
}

function pruneMemory(entry: Map<string, number>, now: number): void {
  const cutoff = now - SCENARIO_TAB_TTL_SECONDS * 1000;
  for (const [tabId, seenAt] of entry) {
    if (seenAt < cutoff) entry.delete(tabId);
  }
}

/**
 * Tracks which browser tabs are live and willing to take over a scenario run,
 * keyed by project and by the scenario tab key of the machine that opened them.
 *
 * Membership is a sorted set of tab ids scored by last-seen timestamp: several
 * tabs can hold the same key, one closing never revokes the others, and a
 * browser that dies without saying goodbye ages out on its own.
 */
export const scenarioTabRegistry = {
  /** Record (or refresh) a live tab. Safe to call repeatedly. */
  async register({
    projectId,
    tabKey,
    tabId,
    now = Date.now(),
  }: {
    projectId: string;
    tabKey: string;
    tabId: string;
    now?: number;
  }): Promise<void> {
    const key = tabSetKey(projectId, tabKey);

    if (!connection) {
      const entry = memoryEntry(key);
      entry.set(tabId, now);
      pruneMemory(entry, now);
      return;
    }

    try {
      await connection
        .multi()
        .zadd(key, now, tabId)
        .expire(key, SCENARIO_TAB_TTL_SECONDS)
        .exec();
    } catch (error) {
      logger.warn({ error, projectId }, "Failed to register scenario tab");
    }
  },

  /**
   * Retire a tab when its subscription ends, leaving it claimable for
   * {@link SCENARIO_TAB_DISCONNECT_GRACE_SECONDS} in case it is only
   * reconnecting. Re-registering within the window restores it outright.
   */
  async unregister({
    projectId,
    tabKey,
    tabId,
    now = Date.now(),
  }: {
    projectId: string;
    tabKey: string;
    tabId: string;
    now?: number;
  }): Promise<void> {
    const key = tabSetKey(projectId, tabKey);
    // Age the entry so it falls out of the live window `grace` from now.
    const retiredScore =
      now -
      (SCENARIO_TAB_TTL_SECONDS - SCENARIO_TAB_DISCONNECT_GRACE_SECONDS) * 1000;

    if (!connection) {
      const entry = memoryTabs.get(key);
      if (entry?.has(tabId)) entry.set(tabId, retiredScore);
      return;
    }

    try {
      // XX: only re-score a member that is still there; never resurrect one
      // that already aged out.
      await connection.zadd(key, "XX", retiredScore, tabId);
    } catch (error) {
      logger.warn({ error, projectId }, "Failed to retire scenario tab");
    }
  },

  /** Whether any tab on that machine is currently listening for this project. */
  async hasLiveTab({
    projectId,
    tabKey,
    now = Date.now(),
  }: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<boolean> {
    const key = tabSetKey(projectId, tabKey);
    const cutoff = now - SCENARIO_TAB_TTL_SECONDS * 1000;

    if (!connection) {
      const entry = memoryTabs.get(key);
      if (!entry) return false;
      pruneMemory(entry, now);
      return entry.size > 0;
    }

    try {
      await connection.zremrangebyscore(key, "-inf", cutoff);
      const count = await connection.zcard(key);
      return count > 0;
    } catch (error) {
      logger.warn({ error, projectId }, "Failed to read scenario tab presence");
      return false;
    }
  },

  /**
   * Park the handed-off run so a tab that is mid-reload when the broadcast goes
   * out still finds it. Broadcasts are fire-and-forget: without this, a run
   * reported as delivered could land in the gap between two subscriptions and
   * be seen by nobody.
   */
  async setPendingNavigate({
    projectId,
    tabKey,
    url,
    now = Date.now(),
  }: {
    projectId: string;
    tabKey: string;
    url: string;
    now?: number;
  }): Promise<void> {
    const key = pendingKey(projectId, tabKey);

    if (!connection) {
      memoryPending.set(key, {
        url,
        expiresAt: now + SCENARIO_TAB_PENDING_TTL_SECONDS * 1000,
      });
      return;
    }

    try {
      await connection.set(key, url, "EX", SCENARIO_TAB_PENDING_TTL_SECONDS);
    } catch (error) {
      logger.warn(
        { error, projectId },
        "Failed to park a scenario tab handoff",
      );
    }
  },

  /** Read and clear whatever a reconnecting tab still owes itself. */
  async takePendingNavigate({
    projectId,
    tabKey,
    now = Date.now(),
  }: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<string | null> {
    const key = pendingKey(projectId, tabKey);

    if (!connection) {
      const entry = memoryPending.get(key);
      memoryPending.delete(key);
      return entry && entry.expiresAt > now ? entry.url : null;
    }

    try {
      const url = await connection.get(key);
      if (url) await connection.del(key);
      return url;
    } catch (error) {
      logger.warn(
        { error, projectId },
        "Failed to read a parked scenario tab handoff",
      );
      return null;
    }
  },
};

/** Test seam: forget every in-memory registration. */
export function resetScenarioTabMemoryRegistry(): void {
  memoryTabs.clear();
  memoryPending.clear();
}
