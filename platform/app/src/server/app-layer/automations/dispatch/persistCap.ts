import { PlanTypes } from "@ee/billing/planTypes";
import type { PlanInfo } from "@ee/licensing/planInfo";
import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { TtlCache } from "~/server/utils/ttlCache";
import { resolveRedis } from "./resolveRedis";

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
 * An unresolvable plan falls back to the paid ceiling, which is open relative
 * to the free tier and closed relative to the enterprise one. That is why the
 * fallback is NEVER cached: a cached guess would hold an enterprise account at
 * a tenth of its allowance for the whole cache window, dropping confirmed
 * matches terminally, on the strength of one failed read. Uncached, the guess
 * costs one dispatch and the next one resolves the real ceiling.
 */
export async function resolvePersistDailyCap(
  projectId: string,
): Promise<number> {
  const cached = await capCache.get(projectId);
  if (cached !== undefined) return cached;

  try {
    const organizationId = await resolveOrganizationId(projectId);
    if (!organizationId) {
      logger.warn(
        { projectId },
        "No organization for this project's automation ceiling, using the " +
          "paid-tier ceiling for this dispatch",
      );
      return env.TRIGGER_PERSIST_DAILY_CAP_PAID;
    }

    const cap = capForPlan(
      await getApp().planProvider.getActivePlan({ organizationId }),
    );
    await capCache.set(projectId, cap);
    return cap;
  } catch (error) {
    logger.warn(
      {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Could not resolve the plan for this project's automation ceiling, " +
        "using the paid-tier ceiling for this dispatch",
    );
    return env.TRIGGER_PERSIST_DAILY_CAP_PAID;
  }
}

/** A contract allowance wins; otherwise the plan's tier decides. */
function capForPlan(plan: PlanInfo): number {
  if (plan.maxTriggerPersistDispatchesPerDay !== undefined) {
    return plan.maxTriggerPersistDispatchesPerDay;
  }
  if (ENTERPRISE_PLAN_TYPES.has(plan.type)) {
    return env.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE;
  }
  if (FREE_PLAN_TYPES.has(plan.type) || plan.free) {
    return env.TRIGGER_PERSIST_DAILY_CAP_FREE;
  }
  return env.TRIGGER_PERSIST_DAILY_CAP_PAID;
}

export interface PersistCapDecision {
  allowed: boolean;
  /** Confirmed dispatches counted for this trigger today, cap included. */
  count: number;
  cap: number;
  /** Confirmed matches dropped today. Zero until the cap is passed. */
  skipped: number;
}

/**
 * The hash tag both cap keys share.
 *
 * Redis Cluster routes a key by the substring inside the first `{}` and
 * rejects a multi-key script whose keys land in different slots. The claim and
 * the day counter are read and written together by one Lua script, so without
 * a shared tag every eval on a clustered install fails with `CROSSSLOT`, gets
 * caught as an ordinary Redis error, and drops the whole fleet to per-worker
 * counters. The (project, trigger) pair is the natural tag: both keys belong
 * to exactly one of them.
 */
function capSlotTag({
  projectId,
  triggerId,
}: {
  projectId: string;
  triggerId: string;
}): string {
  return `{${projectId}:${triggerId}}`;
}

/** `persist-cap:<tag>:<utcDay>`, where the tag is braced and literal. */
export function persistCapKey({
  projectId,
  triggerId,
  now,
}: {
  projectId: string;
  triggerId: string;
  now: Date;
}): string {
  return `persist-cap:${capSlotTag({ projectId, triggerId })}:${Math.floor(
    now.getTime() / DAY_MS,
  )}`;
}

/** `persist-cap-claimed:<tag>:<dedupKey>`, sharing the counter's slot. */
export function persistCapClaimKey({
  projectId,
  triggerId,
  dedupKey,
}: {
  projectId: string;
  triggerId: string;
  dedupKey: string;
}): string {
  return `persist-cap-claimed:${capSlotTag({ projectId, triggerId })}:${dedupKey}`;
}

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();
const claimStore = new Map<string, number>();

/**
 * Hard ceiling on the per-worker claim map.
 *
 * `memoryStore` is keyed per (project, trigger, day) and so is bounded by the
 * customer's own automation count. `claimStore` is not: it holds one entry per
 * (trigger, trace) pair, each living the full 25h window, so during a long
 * Redis outage a busy project would grow it without limit and exhaust the
 * worker heap.
 *
 * Over the ceiling the OLDEST claims are evicted. Evicting a claim that is
 * still live means a retry of that exact dispatch could consume a second slot,
 * but the oldest claims are the least likely to still be retried, and this
 * whole path is already the degraded per-worker approximation of a ceiling.
 * Over-counting a handful of dispatches is a better failure than running out
 * of memory.
 */
const MAX_MEMORY_CLAIMS = 50_000;

/** Claims evicted per overflow, so eviction is amortised rather than per call. */
const CLAIM_EVICTION_BATCH = 1_000;

/**
 * The sweep walks whole maps, so it is time-gated rather than size-gated. Size
 * gating put an O(n) scan on every dispatch once the map passed its threshold,
 * and during an outage that scan deletes nothing (no entry has expired yet)
 * while n keeps growing.
 */
const MEMORY_SWEEP_INTERVAL_MS = 60_000;

let lastMemorySweepAt = 0;

function sweepExpired<V>(
  store: Map<string, V>,
  expiresAtOf: (value: V) => number,
  now: number,
): void {
  for (const [key, value] of store) {
    if (expiresAtOf(value) <= now) store.delete(key);
  }
}

function sweepExpiredMemoryEntries(now: number): void {
  if (now - lastMemorySweepAt < MEMORY_SWEEP_INTERVAL_MS) return;
  lastMemorySweepAt = now;
  sweepExpired(memoryStore, (entry) => entry.expiresAt, now);
  sweepExpired(claimStore, (expiresAt) => expiresAt, now);
}

/** Records a claim, evicting the oldest ones if the map is at its ceiling. */
function rememberClaim(claimKey: string, expiresAt: number): void {
  if (claimStore.size >= MAX_MEMORY_CLAIMS) {
    // Map iteration is insertion order, so the head is the oldest claim.
    let dropped = 0;
    for (const key of claimStore.keys()) {
      claimStore.delete(key);
      if (++dropped >= CLAIM_EVICTION_BATCH) break;
    }
    logger.warn(
      { dropped, size: claimStore.size },
      "In-memory automation cap claims hit their ceiling — evicted the " +
        "oldest claims; retries of those dispatches may double-count",
    );
  }
  claimStore.set(claimKey, expiresAt);
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
  redis,
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
  /** Omit for the App's connection; pass `null` to force the in-memory path. */
  redis?: RedisConnection | null;
}): Promise<PersistCapDecision> {
  const key = persistCapKey({ projectId, triggerId, now });
  const claimKey = persistCapClaimKey({ projectId, triggerId, dedupKey });
  const decide = (count: number): PersistCapDecision => ({
    allowed: count <= cap,
    count,
    cap,
    skipped: Math.max(0, count - cap),
  });

  const viaRedis = await countViaRedis({
    key,
    claimKey,
    connection: resolveRedis(redis),
  });
  if (viaRedis !== null) return decide(viaRedis);
  return decide(countInMemory({ key, claimKey, nowMs: now.getTime() }));
}

/**
 * Claim, count and expire in ONE round trip.
 *
 * The claim and the INCR must land together or not at all. As separate
 * commands, a Redis failure between them leaves the claim held while the count
 * never moved: the dispatch is then allowed by the in-memory fallback, and once
 * Redis recovers the retry finds the claim already taken and re-reads a count
 * that never saw this dispatch. The shared ceiling drifts permanently high, by
 * one slot for every dispatch that hit that window.
 *
 * KEYS[1] is the per-dispatch claim, KEYS[2] the day counter, ARGV[1] the TTL.
 * The counter is only given a TTL when it has none, so the TTL never slides,
 * while a transient first-hit failure still cannot leave an immortal key. That
 * guard is a TTL read rather than `EXPIRE ... NX` because the NX option needs
 * Redis 7, and self-hosted installs still run Redis 6, where the whole eval
 * would fail and degrade the fleet-wide ceiling to per-worker counters.
 * A negative TTL means either no expiry (-1) or no key (-2), and the INCR
 * above has just created or bumped the key, so both cases want the EXPIRE.
 */
const CLAIM_AND_COUNT_SCRIPT = `
local claimed = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')
if not claimed then
  return tonumber(redis.call('GET', KEYS[2]) or '0')
end
local count = redis.call('INCR', KEYS[2])
if redis.call('TTL', KEYS[2]) < 0 then
  redis.call('EXPIRE', KEYS[2], ARGV[1])
end
return count
`;

/**
 * The Redis path. Returns the count, or null when Redis is absent or erroring,
 * which is the caller's signal to fall back to the in-memory counter.
 */
async function countViaRedis({
  key,
  claimKey,
  connection,
}: {
  key: string;
  claimKey: string;
  connection: RedisConnection | null;
}): Promise<number | null> {
  if (!connection) return null;
  try {
    const count = await connection.eval(
      CLAIM_AND_COUNT_SCRIPT,
      2,
      claimKey,
      key,
      String(EXPIRE_SECONDS),
    );
    return Number(count);
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
    return null;
  }
}

/** The per-worker fallback, mirroring the Redis claim-then-count shape. */
function countInMemory({
  key,
  claimKey,
  nowMs,
}: {
  key: string;
  claimKey: string;
  nowMs: number;
}): number {
  sweepExpiredMemoryEntries(nowMs);

  const live = (entry: MemoryEntry | undefined) =>
    entry && entry.expiresAt > nowMs ? entry : undefined;
  const existingClaim = claimStore.get(claimKey);
  if (existingClaim !== undefined && existingClaim > nowMs) {
    return live(memoryStore.get(key))?.count ?? 0;
  }
  rememberClaim(claimKey, nowMs + EXPIRE_SECONDS * 1000);

  const existing = live(memoryStore.get(key));
  if (!existing) {
    memoryStore.set(key, {
      count: 1,
      expiresAt: nowMs + EXPIRE_SECONDS * 1000,
    });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/** How many count reads run at once. See the call site for why they chunk. */
const CAP_COUNT_READ_CHUNK = 100;

/** Runs `each` over `items` a chunk at a time, keeping the results in order. */
async function inChunks<T, R>(
  items: readonly T[],
  size: number,
  each: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(
      ...(await Promise.all(items.slice(start, start + size).map(each))),
    );
  }
  return results;
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
  redis: redisOverride,
}: {
  projectId: string;
  triggerIds: readonly string[];
  now: Date;
  cap: number;
  /** Omit for the App's connection; pass `null` to force the in-memory path. */
  redis?: RedisConnection | null;
}): Promise<Record<string, { count: number; skipped: number }>> {
  const counts: Record<string, { count: number; skipped: number }> = {};
  if (triggerIds.length === 0) return counts;

  const keys = triggerIds.map((triggerId) =>
    persistCapKey({ projectId, triggerId, now }),
  );
  let raw: (string | null)[] = keys.map(() => null);
  const redis = resolveRedis(redisOverride);
  if (redis) {
    try {
      // One GET per key, not one MGET: every trigger's key carries its own
      // hash tag, so on a Redis Cluster a multi-key read spanning triggers
      // fails CROSSSLOT, and this catch would render every count as zero.
      // Chunked because that is one command per automation, and a project can
      // own thousands: the chunk bounds how many are in flight at once, while
      // the loop still covers every automation the list renders.
      raw = await inChunks(keys, CAP_COUNT_READ_CHUNK, (key) => redis.get(key));
    } catch (error) {
      logger.warn(
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not read automation persist cap counts, the list will show " +
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
  lastMemorySweepAt = 0;
}
