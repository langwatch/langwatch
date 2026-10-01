import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { AutomationEmailCapRepository } from "../repositories/automation-email-cap.repository.ts";

const logger = createLogger("langwatch:outbox:emailHourlyCap");

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOURLY_TTL_SECONDS = 7_200;
const DAILY_TTL_SECONDS = 90_000;

type CapDecision = {
  allowed: boolean;
  count: number;
};

type ConsumeInput = {
  counterKey: string;
  claimKey: string;
  now: Instant;
  cap: number;
  increment: number;
  ttlSeconds: number;
  degradation: "hourly" | "daily";
};

export type ConsumeHourlyEmailCapInput = {
  projectId: string;
  triggerId: string;
  now: Instant;
  cap: number;
  dedupKey: string;
};

export type ConsumeDailyEmailCapInput = {
  projectId: string;
  now: Instant;
  cap: number;
  recipientCount: number;
  dedupKey: string;
};

/**
 * Process-owned email cap over the fleet's shared counters, degrading to this
 * process's own when they fail. Claims make retries idempotent. Counter TTLs
 * exceed their fixed windows so a boundary-straddling retry still sees its claim.
 */
export class AutomationEmailCapService {
  private constructor(
    private readonly store: AutomationEmailCapRepository,
    private readonly fallback: AutomationEmailCapRepository,
  ) {}

  static create(input: {
    store: AutomationEmailCapRepository;
    fallback: AutomationEmailCapRepository;
  }): AutomationEmailCapService {
    return new AutomationEmailCapService(input.store, input.fallback);
  }

  consumeHourly(input: ConsumeHourlyEmailCapInput): Promise<CapDecision> {
    const bucket = Math.floor(input.now.epochMilliseconds / HOUR_MS);

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
    const bucket = Math.floor(input.now.epochMilliseconds / DAY_MS);

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
    try {
      return await this.consumeFrom(this.store, input);
    } catch (error) {
      this.logDegradation(input, error);
      return this.consumeFrom(this.fallback, input);
    }
  }

  private async consumeFrom(
    store: AutomationEmailCapRepository,
    input: ConsumeInput,
  ): Promise<CapDecision> {
    const claim = await store.claimSend({
      window: input.counterKey,
      claim: input.claimKey,
      sends: input.increment,
      ttlSeconds: input.ttlSeconds,
      now: input.now,
    });
    const count =
      claim.outcome === "counted"
        ? claim.count
        : await store.countSends({ window: input.counterKey, now: input.now });

    return { allowed: count <= input.cap, count };
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
