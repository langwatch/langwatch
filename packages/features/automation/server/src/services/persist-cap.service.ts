import { createLogger } from "@langwatch/observability";
import type {
  AutomationPersistCapConfig,
  AutomationPersistCapCount,
  AutomationPersistCapDecision,
  AutomationPlan,
  AutomationPlanProvider,
} from "@langwatch/automation-contract";
import type { ProjectService } from "@langwatch/project-contract";

const logger = createLogger("langwatch:automations:persist-cap");

const DAY_MS = 86_400_000;

const EXPIRE_SECONDS = 90_000;

const CAP_CACHE_TTL_MS = 10 * 60 * 1000;
const capCache = new Map<string, { value: number; expiresAt: number }>();

/** Plan type is provider-owned string data, so unknown paid plans use the paid cap. */
const ENTERPRISE_PLAN_TYPES = new Set<string>(["ENTERPRISE"]);

const FREE_PLAN_TYPES = new Set<string>(["FREE", "LAUNCH"]);

export type PersistCapConfig = AutomationPersistCapConfig;

export interface PersistCapDependencies {
  projects: ProjectService;
  planProvider: AutomationPlanProvider;
  config: PersistCapConfig;
}

/** Redis commands used by the cap, independent of a concrete client. */
export interface AutomationPersistCapRedisPort {
  eval(script: string, keyCount: number, ...keysAndArguments: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export type ConsumePersistCapSlotInput = {
  projectId: string;
  triggerId: string;
  now: Date;
  cap: number;
  dedupKey: string;
};

export type ReadPersistCapCountsInput = {
  projectId: string;
  triggerIds: readonly string[];
  now: Date;
  cap: number;
};

export type PersistCapKeyInput = Pick<
  ConsumePersistCapSlotInput,
  "projectId" | "triggerId" | "now"
>;

export type PersistCapClaimKeyInput = Pick<
  ConsumePersistCapSlotInput,
  "projectId" | "triggerId" | "dedupKey"
>;

export type ConsumePersistCapSlotOptions = ConsumePersistCapSlotInput & {
  redis?: AutomationPersistCapRedisPort | null;
};

export type ReadPersistCapCountsOptions = ReadPersistCapCountsInput & {
  redis?: AutomationPersistCapRedisPort | null;
};

/** One process-owned service for plan resolution and idempotent cap claims. */
export class AutomationPersistCapService {
  private constructor(
    private readonly dependencies: PersistCapDependencies,
    private readonly redis: AutomationPersistCapRedisPort | null,
  ) {}

  static create(
    input: PersistCapDependencies & { redis?: AutomationPersistCapRedisPort | null },
  ): AutomationPersistCapService {
    return new AutomationPersistCapService(input, input.redis ?? null);
  }

  /** `persist-cap:<tag>:<utcDay>`, where the tag is braced and literal. */
  static persistCapKey({
    projectId,
    triggerId,
    now,
  }: {
    projectId: string;
    triggerId: string;
    now: Date;
  }): string {
    return `persist-cap:${AutomationPersistCapService.capSlotTag({ projectId, triggerId })}:${Math.floor(
      now.getTime() / DAY_MS,
    )}`;
  }

  /** `persist-cap-claimed:<tag>:<dedupKey>`, sharing the counter's slot. */
  static persistCapClaimKey({
    projectId,
    triggerId,
    dedupKey,
  }: {
    projectId: string;
    triggerId: string;
    dedupKey: string;
  }): string {
    return `persist-cap-claimed:${AutomationPersistCapService.capSlotTag({ projectId, triggerId })}:${dedupKey}`;
  }

  /** Test-only: clear in-memory state. No-op for Redis. */
  static resetMemoryStore(): void {
    capCache.clear();
    memoryStore.clear();
    claimStore.clear();
    lastMemorySweepAt = 0;
  }

  /**
   * Claim before incrementing so outbox retries are idempotent. Continue counting
   * past the cap because the excess is the customer-visible skipped total.
   */
  static async consumePersistCapSlot({
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
    redis?: AutomationPersistCapRedisPort | null;
  }): Promise<PersistCapDecision> {
    const key = AutomationPersistCapService.persistCapKey({ projectId, triggerId, now });
    const claimKey = AutomationPersistCapService.persistCapClaimKey({
      projectId,
      triggerId,
      dedupKey,
    });
    const decide = (count: number): PersistCapDecision => ({
      allowed: count <= cap,
      count,
      cap,
      skipped: Math.max(0, count - cap),
    });

    const viaRedis = await AutomationPersistCapService.tryCountViaRedis({
      key,
      claimKey,
      connection: redis ?? null,
    });
    if (viaRedis !== null) {
      return decide(viaRedis);
    }

    return decide(
      AutomationPersistCapService.countInMemory({ key, claimKey, nowMs: now.getTime() }),
    );
  }

  /** Resolve a contract override or plan-tier cap. Failed lookups use, but do not cache, paid. */
  async resolvePersistDailyCap(projectId: string): Promise<number> {
    const cached = capCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (cached) {
      capCache.delete(projectId);
    }

    try {
      const organizationId = await this.dependencies.projects.getOrganizationId(projectId);

      const cap = AutomationPersistCapService.capForPlan(
        await this.dependencies.planProvider.getActivePlan({ organizationId }),
        this.dependencies.config,
      );
      capCache.set(projectId, { value: cap, expiresAt: Date.now() + CAP_CACHE_TTL_MS });

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

      return this.dependencies.config.paid;
    }
  }

  /** The instance form: the same claim, against the connection this service holds. */
  consumePersistCapSlot(input: ConsumePersistCapSlotInput): Promise<AutomationPersistCapDecision> {
    return AutomationPersistCapService.consumePersistCapSlot({ ...input, redis: this.redis });
  }

  /**
   * How many confirmed matches each of these triggers dropped today, for the
   * automations list. Read-only: it never consumes a slot.
   */
  async readPersistCapCounts({
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
    if (triggerIds.length === 0) {
      return counts;
    }

    const keys = triggerIds.map((triggerId) =>
      AutomationPersistCapService.persistCapKey({ projectId, triggerId, now }),
    );
    let raw: (string | null)[] = keys.map(() => null);
    // Held as a local so it stays narrowed inside the callback below.
    const redis = this.redis;
    if (redis) {
      try {
        // Separate hash slots forbid MGET; chunks bound concurrent per-key reads.
        raw = await AutomationPersistCapService.inChunks(keys, CAP_COUNT_READ_CHUNK, (key) =>
          redis.get(key),
        );
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

        return entry && entry.expiresAt > now.getTime() ? String(entry.count) : null;
      });
    }

    triggerIds.forEach((triggerId, index) => {
      const count = raw[index] ? Number(raw[index]) : 0;
      counts[triggerId] = { count, skipped: Math.max(0, count - cap) };
    });

    return counts;
  }

  /** A contract allowance wins; otherwise the plan's tier decides. */
  private static capForPlan(plan: AutomationPlan, config: PersistCapConfig): number {
    if (plan.maxTriggerPersistDispatchesPerDay !== undefined) {
      return plan.maxTriggerPersistDispatchesPerDay;
    }

    if (ENTERPRISE_PLAN_TYPES.has(plan.type)) {
      return config.enterprise;
    }

    if (FREE_PLAN_TYPES.has(plan.type) || plan.free) {
      return config.free;
    }

    return config.paid;
  }

  /** Keep the claim and counter in one Redis Cluster slot for the atomic script. */
  private static capSlotTag({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): string {
    return `{${projectId}:${triggerId}}`;
  }

  private static sweepExpired<V>(
    store: Map<string, V>,
    expiresAtOf: (value: V) => number,
    now: number,
  ): void {
    for (const [key, value] of store) {
      if (expiresAtOf(value) <= now) {
        store.delete(key);
      }
    }
  }

  private static sweepExpiredMemoryEntries(now: number): void {
    if (now - lastMemorySweepAt < MEMORY_SWEEP_INTERVAL_MS) {
      return;
    }

    lastMemorySweepAt = now;
    AutomationPersistCapService.sweepExpired(memoryStore, (entry) => entry.expiresAt, now);
    AutomationPersistCapService.sweepExpired(claimStore, (expiresAt) => expiresAt, now);
  }

  /** Records a claim, evicting the oldest ones if the map is at its ceiling. */
  private static rememberClaim(claimKey: string, expiresAt: number): void {
    if (claimStore.size >= MAX_MEMORY_CLAIMS) {
      // Map iteration is insertion order, so the head is the oldest claim.
      let dropped = 0;
      for (const key of claimStore.keys()) {
        claimStore.delete(key);
        if (++dropped >= CLAIM_EVICTION_BATCH) {
          break;
        }
      }

      logger.warn(
        { dropped, size: claimStore.size },
        "In-memory automation cap claims hit their ceiling — evicted the " +
          "oldest claims; retries of those dispatches may double-count",
      );
    }

    claimStore.set(claimKey, expiresAt);
  }

  /** Return null when Redis is absent or failing so the caller uses its bounded fallback. */
  private static async tryCountViaRedis({
    key,
    claimKey,
    connection,
  }: {
    key: string;
    claimKey: string;
    connection: AutomationPersistCapRedisPort | null;
  }): Promise<number | null> {
    if (!connection) {
      return null;
    }

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
      // A throw would replay the side effect; the bounded fallback is deliberately per-worker.
      logger.error(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error consuming an automation persist cap slot — the ceiling " +
          "is DEGRADED to per-worker in-memory counters until Redis recovers",
      );

      return null;
    }
  }

  /** The per-worker fallback, mirroring the Redis claim-then-count shape. */
  private static countInMemory({
    key,
    claimKey,
    nowMs,
  }: {
    key: string;
    claimKey: string;
    nowMs: number;
  }): number {
    AutomationPersistCapService.sweepExpiredMemoryEntries(nowMs);

    const live = (entry: MemoryEntry | undefined) =>
      entry && entry.expiresAt > nowMs ? entry : undefined;
    const existingClaim = claimStore.get(claimKey);
    if (existingClaim !== undefined && existingClaim > nowMs) {
      return live(memoryStore.get(key))?.count ?? 0;
    }

    AutomationPersistCapService.rememberClaim(claimKey, nowMs + EXPIRE_SECONDS * 1000);

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

  /** Runs `each` over `items` a chunk at a time, keeping the results in order. */
  private static async inChunks<T, R>(
    items: readonly T[],
    size: number,
    each: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let start = 0; start < items.length; start += size) {
      results.push(...(await Promise.all(items.slice(start, start + size).map(each))));
    }

    return results;
  }
}

export type PersistCapDecision = AutomationPersistCapDecision;

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();
const claimStore = new Map<string, number>();

/** Bound degraded per-worker claims; evicting oldest may conservatively double-count a retry. */
const MAX_MEMORY_CLAIMS = 50_000;

/** Claims evicted per overflow, so eviction is amortised rather than per call. */
const CLAIM_EVICTION_BATCH = 1_000;

/** Time-gate the O(n) expiry sweep so an outage does not add a scan to every dispatch. */
const MEMORY_SWEEP_INTERVAL_MS = 60_000;

let lastMemorySweepAt = 0;

/**
 * Claim, count and expire atomically. The TTL check retains Redis 6 support and
 * prevents both immortal counters and a sliding expiry.
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

/** How many count reads run at once. See the call site for why they chunk. */
const CAP_COUNT_READ_CHUNK = 100;
