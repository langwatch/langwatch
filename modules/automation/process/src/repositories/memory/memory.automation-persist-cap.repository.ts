import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import { derivePersistCapDay } from "../../rules/persist-cap.rules.ts";
import {
  AutomationPersistCapRepository,
  type PersistCapSlotCount,
  type PersistCapSlotRef,
  type PersistCapTriggerCount,
} from "../automation-persist-cap.repository.ts";

/** A counter outlives its UTC day by an hour, as the Redis keys do. */
const EXPIRE_MS = 90_000_000;

/** Bound the claims; evicting the oldest may conservatively double-count a retry. */
const MAX_CLAIMS = 50_000;

/** Claims evicted per overflow, so eviction is amortised rather than per call. */
const CLAIM_EVICTION_BATCH = 1_000;

/** Time-gate the O(n) expiry sweep so a long outage does not add a scan to every dispatch. */
const SWEEP_INTERVAL_MS = 60_000;

type Counter = { count: number; expiresAt: number };

/** The counter in this process only: the memory tier, and the Redis tier's degraded fallback. */
export class MemoryAutomationPersistCapRepository extends AutomationPersistCapRepository {
  static create(
    input: { logger?: Pick<Logger, "warn"> } = {},
  ): MemoryAutomationPersistCapRepository {
    return new MemoryAutomationPersistCapRepository(
      input.logger ?? createLogger("langwatch:automations:persist-cap"),
    );
  }

  readonly #counters = new Map<string, Counter>();
  readonly #claims = new Map<string, number>();
  readonly #logger: Pick<Logger, "warn">;
  #lastSweepAt = 0;

  private constructor(logger: Pick<Logger, "warn">) {
    super();
    this.#logger = logger;
  }

  async consumeSlot(slot: PersistCapSlotRef): Promise<PersistCapSlotCount> {
    const nowMs = slot.now.epochMilliseconds;
    this.#sweep(nowMs);
    const key = counterKey(slot);
    const claimKey = `${slot.projectId}\u0000${slot.triggerId}\u0000${slot.dedupKey}`;

    const claimedUntil = this.#claims.get(claimKey);
    if (claimedUntil !== undefined && claimedUntil > nowMs) {
      return { outcome: "counted", count: this.#liveCount(key, nowMs) };
    }

    this.#rememberClaim(claimKey, nowMs + EXPIRE_MS);
    const existing = this.#counters.get(key);
    if (!existing || existing.expiresAt <= nowMs) {
      this.#counters.set(key, { count: 1, expiresAt: nowMs + EXPIRE_MS });
      return { outcome: "counted", count: 1 };
    }

    existing.count += 1;
    return { outcome: "counted", count: existing.count };
  }

  async findCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
  }): Promise<PersistCapTriggerCount[]> {
    return input.triggerIds.map((triggerId) => ({
      triggerId,
      count: this.#liveCount(
        counterKey({ projectId: input.projectId, triggerId, now: input.now }),
        input.now.epochMilliseconds,
      ),
    }));
  }

  #liveCount(key: string, nowMs: number): number {
    const counter = this.#counters.get(key);
    return counter && counter.expiresAt > nowMs ? counter.count : 0;
  }

  #rememberClaim(claimKey: string, expiresAt: number): void {
    if (this.#claims.size >= MAX_CLAIMS) {
      // Map iteration is insertion order, so the head is the oldest claim.
      let dropped = 0;
      for (const key of this.#claims.keys()) {
        this.#claims.delete(key);
        if (++dropped >= CLAIM_EVICTION_BATCH) break;
      }
      this.#logger.warn(
        { dropped, size: this.#claims.size },
        "In-memory automation cap claims hit their ceiling — evicted the " +
          "oldest claims; retries of those dispatches may double-count",
      );
    }
    this.#claims.set(claimKey, expiresAt);
  }

  #sweep(nowMs: number): void {
    if (nowMs - this.#lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.#lastSweepAt = nowMs;
    for (const [key, counter] of this.#counters) {
      if (counter.expiresAt <= nowMs) this.#counters.delete(key);
    }
    for (const [key, expiresAt] of this.#claims) {
      if (expiresAt <= nowMs) this.#claims.delete(key);
    }
  }
}

function counterKey(input: { projectId: string; triggerId: string; now: Instant }): string {
  return `${input.projectId}\u0000${input.triggerId}\u0000${derivePersistCapDay(input.now)}`;
}
