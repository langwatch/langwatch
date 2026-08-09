import { PlanTypes } from "@ee/billing/planTypes";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { connection } from "~/server/redis";
import { TtlCache } from "~/server/utils/ttlCache";

const logger = createLogger("langwatch:automations:persist-cap");

const DAY_MS = 86_400_000;

/**
 * 25h, one hour past the window it covers, so the day counter and its claim
 * gate outlive that window and a boundary-straddling retry still finds the
 * original claim. Same headroom the tenant email cap uses.
 */
const EXPIRE_SECONDS = 90_000;

/** Plan resolution is a two-hop DB read; the answer changes on the order of days. */
const capCache = new TtlCache<number>(
  10 * 60 * 1000,
  "ttlcache:persist-daily-cap:",
);

/**
 * Plans that get the enterprise ceiling. Everything else that is not free gets
 * the paid one. `PlanInfo.type` is a bare string with no compile-time union, so
 * this compares against the PlanTypes constants rather than switching
 * exhaustively.
 */
const ENTERPRISE_PLAN_TYPES = new Set<string>([PlanTypes.ENTERPRISE]);

const FREE_PLAN_TYPES = new Set<string>([PlanTypes.FREE, PlanTypes.LAUNCH]);

/**
 * The daily ceiling on CONFIRMED persist dispatches for one trigger.
 *
 * Resolution order: a per-contract allowance on the plan wins, then the plan
 * tier's env-configured default.
 *
 * Fails OPEN, unlike the visibility window next door. Over-throttling an
 * automation silently drops customer work that looked like it was configured
 * to happen, which is worse than letting an unresolvable account run at the
 * paid ceiling for the ten minutes it takes the cache to turn over. The
 * retention sweep and the overflow fix already bound what that costs us.
 */
export async function resolvePersistDailyCap(
  projectId: string,
): Promise<number> {
  const cached = await capCache.get(projectId);
  if (cached !== undefined) return cached;

  let cap = env.TRIGGER_PERSIST_DAILY_CAP_PAID;
  try {
    const organizationId = await resolveOrganizationId(projectId);
    if (organizationId) {
      const plan = await getApp().planProvider.getActivePlan({
        organizationId,
      });
      cap =
        plan.maxTriggerPersistDispatchesPerDay ??
        (ENTERPRISE_PLAN_TYPES.has(plan.type)
          ? env.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE
          : FREE_PLAN_TYPES.has(plan.type) || plan.free
            ? env.TRIGGER_PERSIST_DAILY_CAP_FREE
            : env.TRIGGER_PERSIST_DAILY_CAP_PAID);
    }
  } catch (error) {
    logger.warn(
      {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Could not resolve the plan for this project's automation ceiling — " +
        "falling back to the paid-tier ceiling",
    );
  }

  await capCache.set(projectId, cap);
  return cap;
}

export interface PersistCapDecision {
  allowed: boolean;
  /** Confirmed dispatches counted for this trigger today, cap included. */
  count: number;
  cap: number;
  /** Confirmed matches dropped today. Zero until the cap is passed. */
  skipped: number;
}

/** `persist-cap:{projectId}:{triggerId}:{utcDay}` */
export function persistCapKey({
  projectId,
  triggerId,
  now,
}: {
  projectId: string;
  triggerId: string;
  now: Date;
}): string {
  return `persist-cap:${projectId}:${triggerId}:${Math.floor(
    now.getTime() / DAY_MS,
  )}`;
}

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();
const claimStore = new Map<string, number>();

const MEMORY_GC_THRESHOLD = 1000;
function sweepExpiredMemoryEntries(now: number): void {
  if (memoryStore.size >= MEMORY_GC_THRESHOLD) {
    for (const [key, entry] of memoryStore) {
      if (entry.expiresAt <= now) memoryStore.delete(key);
    }
  }
  if (claimStore.size >= MEMORY_GC_THRESHOLD) {
    for (const [key, expiresAt] of claimStore) {
      if (expiresAt <= now) claimStore.delete(key);
    }
  }
}

/**
 * Consumes one slot of a trigger's daily ceiling for ONE confirmed persist
 * dispatch, and reports whether that dispatch may proceed.
 *
 * Two properties matter more than the counting itself:
 *
 * RETRY SAFETY. The outbox replays the SAME dispatch on a retryable failure.
 * Counting per attempt would let a flapping provider burn a customer's whole
 * allowance on one trace, so the INCR sits behind a per-dispatch SET-NX claim
 * exactly as the email caps do: only the worker that newly wins the claim
 * consumes a slot, and a retry re-reads the running count.
 *
 * COUNTING PAST THE CAP. The counter keeps climbing after the ceiling is
 * reached, so `count - cap` is how many confirmed matches were dropped today.
 * That number is what the automations list shows the customer and what runaway
 * containment measures against project traffic. Stopping the counter at the cap
 * would make a trigger that overshot by five look identical to one that
 * overshot by fifty thousand.
 */
export async function consumePersistCapSlot({
  projectId,
  triggerId,
  now,
  cap,
  dedupKey,
}: {
  projectId: string;
  triggerId: string;
  now: Date;
  cap: number;
  /**
   * Stable identity for THIS logical dispatch — the (trigger, trace) pair. An
   * outbox retry of the same dispatch presents the same key and must not
   * consume a second slot.
   */
  dedupKey: string;
}): Promise<PersistCapDecision> {
  const key = persistCapKey({ projectId, triggerId, now });
  const claimKey = `persist-cap-claimed:${dedupKey}`;
  const decide = (count: number): PersistCapDecision => ({
    allowed: count <= cap,
    count,
    cap,
    skipped: Math.max(0, count - cap),
  });

  if (connection) {
    try {
      const claimed = await connection.set(
        claimKey,
        "1",
        "EX",
        EXPIRE_SECONDS,
        "NX",
      );
      if (!claimed) {
        const raw = await connection.get(key);
        return decide(raw ? Number(raw) : 0);
      }
      const count = await connection.incr(key);
      // TTL set with NX semantics so it never slides, but a transient
      // first-hit failure cannot leave an immortal key either.
      await connection.expire(key, EXPIRE_SECONDS, "NX");
      return decide(count);
    } catch (error) {
      // A Redis blip must not throw here: the dispatcher treats a throw as
      // retryable and would replay the side effect. Fall back to the in-memory
      // counter so the ceiling keeps working approximately. ERROR, not warn —
      // the cap is now per-worker, so the true cross-worker rate can exceed it.
      logger.error(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error consuming an automation persist cap slot — the ceiling " +
          "is DEGRADED to per-worker in-memory counters until Redis recovers",
      );
    }
  }

  const nowMs = now.getTime();
  sweepExpiredMemoryEntries(nowMs);

  const existingClaim = claimStore.get(claimKey);
  if (existingClaim !== undefined && existingClaim > nowMs) {
    const existing = memoryStore.get(key);
    if (!existing || existing.expiresAt <= nowMs) return decide(0);
    return decide(existing.count);
  }
  claimStore.set(claimKey, nowMs + EXPIRE_SECONDS * 1000);

  const existing = memoryStore.get(key);
  if (!existing || existing.expiresAt <= nowMs) {
    memoryStore.set(key, {
      count: 1,
      expiresAt: nowMs + EXPIRE_SECONDS * 1000,
    });
    return decide(1);
  }
  existing.count += 1;
  return decide(existing.count);
}

/**
 * How many confirmed matches each of these triggers dropped today, for the
 * automations list. Read-only: it never consumes a slot.
 */
export async function readPersistCapCounts({
  projectId,
  triggerIds,
  now,
  cap,
}: {
  projectId: string;
  triggerIds: readonly string[];
  now: Date;
  cap: number;
}): Promise<Record<string, { count: number; skipped: number }>> {
  const counts: Record<string, { count: number; skipped: number }> = {};
  if (triggerIds.length === 0) return counts;

  const keys = triggerIds.map((triggerId) =>
    persistCapKey({ projectId, triggerId, now }),
  );
  let raw: (string | null)[] = keys.map(() => null);
  if (connection) {
    try {
      raw = await connection.mget(...keys);
    } catch (error) {
      logger.warn(
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not read automation persist cap counts — the list will show " +
          "no skipped matches for this render",
      );
    }
  } else {
    raw = keys.map((key) => {
      const entry = memoryStore.get(key);
      return entry && entry.expiresAt > now.getTime()
        ? String(entry.count)
        : null;
    });
  }

  triggerIds.forEach((triggerId, index) => {
    const count = raw[index] ? Number(raw[index]) : 0;
    counts[triggerId] = { count, skipped: Math.max(0, count - cap) };
  });
  return counts;
}

/** Test-only: clear in-memory state. No-op for Redis. */
export function _resetMemoryPersistCapStore(): void {
  memoryStore.clear();
  claimStore.clear();
}
