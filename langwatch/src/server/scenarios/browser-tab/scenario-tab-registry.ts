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

function tabSetKey(projectId: string, tabKey: string): string {
  return `${KEY_PREFIX}:${projectId}:${tabKey}`;
}

/**
 * In-process stand-in used when Redis is not configured. A deployment without
 * Redis is single-instance by definition, so a module-level map sees every
 * subscription the same way Redis would.
 */
const memoryTabs = new Map<string, Map<string, number>>();

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

  /** Drop a tab as soon as its subscription ends. */
  async unregister({
    projectId,
    tabKey,
    tabId,
  }: {
    projectId: string;
    tabKey: string;
    tabId: string;
  }): Promise<void> {
    const key = tabSetKey(projectId, tabKey);

    if (!connection) {
      memoryTabs.get(key)?.delete(tabId);
      return;
    }

    try {
      await connection.zrem(key, tabId);
    } catch (error) {
      logger.warn({ error, projectId }, "Failed to unregister scenario tab");
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
};

/** Test seam: forget every in-memory registration. */
export function resetScenarioTabMemoryRegistry(): void {
  memoryTabs.clear();
}
