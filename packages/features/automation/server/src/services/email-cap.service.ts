import { createLogger } from "@langwatch/observability";
import type { AutomationEmailCapStorePort } from "../ports/email-cap.port";

const logger = createLogger("langwatch:outbox:emailHourlyCap");

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOURLY_TTL_SECONDS = 7_200;
const DAILY_TTL_SECONDS = 90_000;
const EXPIRE_IF_UNSET_SCRIPT = `
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
`;

type CapDecision = {
  allowed: boolean;
  count: number;
};

type ConsumeInput = {
  counterKey: string;
  claimKey: string;
  now: Date;
  cap: number;
  increment: number;
  ttlSeconds: number;
  degradation: "hourly" | "daily";
};

type MemoryEntry = {
  count: number;
  expiresAt: number;
};

/** Per-process fallback kept private to the process-owned cap service. */
class EmailCapMemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();

  consume(input: ConsumeInput): CapDecision {
    const now = input.now.getTime();
    this.sweepExpired(now);

    const claim = this.entries.get(`claim:${input.claimKey}`);
    const alreadyClaimed = claim !== void 0 && claim.expiresAt > now;
    const counterKey = `counter:${input.counterKey}`;
    const existing = this.entries.get(counterKey);

    if (alreadyClaimed) {
      const count = existing && existing.expiresAt > now ? existing.count : 0;

      return { allowed: count <= input.cap, count };
    }

    this.entries.set(`claim:${input.claimKey}`, {
      count: 0,
      expiresAt: now + input.ttlSeconds * 1_000,
    });

    if (!existing || existing.expiresAt <= now) {
      this.entries.set(counterKey, {
        count: input.increment,
        expiresAt: now + input.ttlSeconds * 1_000,
      });

      return {
        allowed: input.increment <= input.cap,
        count: input.increment,
      };
    }

    existing.count += input.increment;

    return { allowed: existing.count <= input.cap, count: existing.count };
  }

  private sweepExpired(now: number): void {
    if (this.entries.size >= 1_000) {
      for (const [key, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(key);
        }
      }
    }
  }
}

export type ConsumeHourlyEmailCapInput = {
  projectId: string;
  triggerId: string;
  now: Date;
  cap: number;
  dedupKey: string;
};

export type ConsumeDailyEmailCapInput = {
  projectId: string;
  now: Date;
  cap: number;
  recipientCount: number;
  dedupKey: string;
};

/**
 * Process-owned email cap with a Redis counter and a per-process fallback.
 * Claims make retries idempotent. Counter TTLs exceed their fixed windows so
 * a boundary-straddling retry still sees its original claim.
 */
export class AutomationEmailCapService {
  private readonly memory = new EmailCapMemoryStore();

  private constructor(private readonly store: AutomationEmailCapStorePort | null) {}

  static create(input: { store: AutomationEmailCapStorePort | null }): AutomationEmailCapService {
    return new AutomationEmailCapService(input.store);
  }

  consumeHourly(input: ConsumeHourlyEmailCapInput): Promise<CapDecision> {
    const bucket = Math.floor(input.now.getTime() / HOUR_MS);

    return this.consume({
      counterKey: `trigger-email-cap:${input.projectId}:${input.triggerId}:${bucket}`,
      claimKey: `cap-claimed:${input.dedupKey}`,
      now: input.now,
      cap: input.cap,
      increment: 1,
      ttlSeconds: HOURLY_TTL_SECONDS,
      degradation: "hourly",
    });
  }

  consumeDaily(input: ConsumeDailyEmailCapInput): Promise<CapDecision> {
    const bucket = Math.floor(input.now.getTime() / DAY_MS);

    return this.consume({
      counterKey: `trigger-email-tenant-cap:${input.projectId}:${bucket}`,
      claimKey: `tenant-cap-claimed:${input.dedupKey}`,
      now: input.now,
      cap: input.cap,
      increment: input.recipientCount,
      ttlSeconds: DAILY_TTL_SECONDS,
      degradation: "daily",
    });
  }

  private async consume(input: ConsumeInput): Promise<CapDecision> {
    const distributed = await this.tryConsumeDistributed(input);
    if (distributed) {
      return distributed;
    }

    return this.memory.consume(input);
  }

  private async tryConsumeDistributed(input: ConsumeInput): Promise<CapDecision | null> {
    if (!this.store) {
      return null;
    }

    try {
      const claimed = await this.store.trySet(input.claimKey, "1", "EX", input.ttlSeconds, "NX");

      if (!claimed) {
        const rawCount = await this.store.tryGet(input.counterKey);
        const count = rawCount ? Number(rawCount) : 0;

        return { allowed: count <= input.cap, count };
      }

      const count =
        input.degradation === "hourly"
          ? await this.store.incr(input.counterKey)
          : await this.store.incrby(input.counterKey, input.increment);

      await this.store.eval(EXPIRE_IF_UNSET_SCRIPT, 1, input.counterKey, String(input.ttlSeconds));

      return { allowed: count <= input.cap, count };
    } catch (error) {
      this.logDegradation(input, error);

      return null;
    }
  }

  private logDegradation(input: ConsumeInput, error: unknown): void {
    const fields = {
      key: input.counterKey,
      error: error instanceof Error ? error.message : String(error),
    };
    if (input.degradation === "hourly") {
      logger.error(
        fields,
        "Redis error consuming email cap slot — cap DEGRADED to per-worker " +
          "in-memory counters until Redis recovers; cross-worker rate may " +
          "exceed the configured cap",
      );

      return;
    }

    logger.warn(
      fields,
      "Redis error consuming tenant email cap slot — daily cap DEGRADED to " +
        "per-worker in-memory counters until Redis recovers; cross-worker " +
        "rate may exceed the configured cap",
    );
  }
}
