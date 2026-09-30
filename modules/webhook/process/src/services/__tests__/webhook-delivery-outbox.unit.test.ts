// SPDX-License-Identifier: Apache-2.0

/**
 * How the delivery process asks the outbox to run its sends.
 *
 * The retry ladder, the attempt count and the lease are a delivery promise —
 * "we keep trying for a day, and a slow receiver does not get the same
 * batch twice" — and none of it is in force unless the process manager
 * actually hands the runtime its configuration. It declared one for a while
 * and never passed it, so every send ran on the runtime defaults instead.
 *
 * These cases assert the promise rather than the numbers: that a
 * configuration is handed over at all, that the schedule is the webhook
 * ladder and not the runtime's default, that the ladder and the attempt count
 * together still reach a day, and that the lease outlasts a slow send.
 */

import { describe, expect, it } from "vitest";

import {
  WEBHOOK_RETRY_LADDER_MS,
  WEBHOOK_SEND_MAX_ATTEMPTS,
} from "../../rules/webhook-delivery-contract.rules.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";

type OutboxOptions = {
  maxAttempts?: number;
  concurrency?: number;
  batchSize?: number;
  leaseDurationMs?: number;
  retryDelayMs?: (params: { attempt: number }) => number;
};

/** Records what the applier asks of the builder, and answers itself for chaining. */
function recordedOutboxConfig(): OutboxOptions | undefined {
  let outbox: OutboxOptions | undefined;
  const builder = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          if (property === "outbox") outbox = args[0] as OutboxOptions;
          return builder;
        };
      },
    },
  );

  WebhookDeliveryService.create({} as never).processManager()(builder as never);
  return outbox;
}

const HOUR = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * HOUR;
/** Jitter pinned to its midpoint: the schedule under test is the ladder's. */
const midpoint = () => 0.5;

/** Whether a jittered delay sits within a fifth either side of its ladder step. */
function isAround(delay: number | undefined, step: number | undefined): boolean {
  if (delay === undefined || step === undefined) return false;
  return delay >= step - step / 5 && delay <= step + step / 5;
}

describe("the webhook delivery process manager's outbox", () => {
  describe("given the process manager is built", () => {
    it("hands the runtime a configuration, rather than leaving sends on the defaults", () => {
      expect(recordedOutboxConfig()).toBeDefined();
    });
  });

  describe("given its retry schedule", () => {
    /** @scenario Delivery retry follows the stable ladder */
    it("is the webhook ladder, not whatever the runtime would have used", () => {
      const retryDelayMs = recordedOutboxConfig()?.retryDelayMs;

      expect(isAround(retryDelayMs?.({ attempt: 1 }), WEBHOOK_RETRY_LADDER_MS[0])).toBe(true);
      expect(
        isAround(
          retryDelayMs?.({ attempt: WEBHOOK_RETRY_LADDER_MS.length }),
          WEBHOOK_RETRY_LADDER_MS.at(-1),
        ),
      ).toBe(true);
    });

    it("holds at the ladder's last step once it runs off the end", () => {
      const retryDelayMs = recordedOutboxConfig()?.retryDelayMs;

      expect(
        isAround(retryDelayMs?.({ attempt: WEBHOOK_SEND_MAX_ATTEMPTS }), WEBHOOK_RETRY_LADDER_MS.at(-1)),
      ).toBe(true);
    });

    it("keeps trying for a day, which is the promise the ladder was sized for", () => {
      const config = recordedOutboxConfig();
      const attempts = config?.maxAttempts ?? 0;
      const retryDelayMs = config?.retryDelayMs;
      const total = Array.from(
        { length: attempts - 1 },
        (_, index) => retryDelayMs?.({ attempt: index + 1 }) ?? 0,
      ).reduce((sum, delay) => sum + delay, 0);

      // Under full +20% jitter too: the bound holds for any draw.
      expect(total).toBeLessThanOrEqual(ONE_DAY_MS);
      expect(total).toBeGreaterThan(ONE_DAY_MS / 2);
    });
  });

  describe("given its lease", () => {
    it("covers a whole batch of slow sends, so one is not handed to a second worker mid-flight", () => {
      // The service's own note: a receiver may burn the full ten seconds, and
      // a lease has to cover every send in the batch it claimed. Losing the
      // lease mid-batch means the receiver gets those deliveries twice.
      const config = recordedOutboxConfig();
      const slowestSendMs = 10_000;

      expect(config?.batchSize).toBeGreaterThan(0);
      expect(config?.leaseDurationMs ?? 0).toBeGreaterThanOrEqual(
        (config?.batchSize ?? 0) * slowestSendMs,
      );
    });
  });

  describe("given its concurrency", () => {
    it("sends more than one batch at a time, because batches are independent", () => {
      expect(recordedOutboxConfig()?.concurrency ?? 0).toBeGreaterThan(1);
    });
  });

  /** @scenario The retry ladder holds its last attempt inside one day */
  it("keeps the cumulative schedule within a day and settles at 4h", () => {
    let elapsed = 0;
    const delays: number[] = [];
    for (let attempt = 1; attempt < WEBHOOK_SEND_MAX_ATTEMPTS; attempt++) {
      const delay = WebhookDeliveryService.retryDelayMs({ attempt, random: midpoint });
      delays.push(delay);
      elapsed += delay;
    }
    // The final retry fires inside one day of the first failure.
    expect(elapsed).toBeLessThanOrEqual(ONE_DAY_MS);
    // And the ladder is not trivially short: it rides out a working day.
    expect(elapsed).toBeGreaterThan(12 * HOUR);
    // Cadence settles at 4h once the explicit rungs are exhausted.
    expect(delays.at(-1)).toBe(4 * HOUR);
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 99, random: midpoint })).toBe(4 * HOUR);
    // The explicit rungs are exactly the documented schedule.
    expect(WEBHOOK_RETRY_LADDER_MS).toEqual([
      60_000,
      5 * 60_000,
      15 * 60_000,
      30 * 60_000,
      HOUR,
      2 * HOUR,
      4 * HOUR,
    ]);
  });

  /** @scenario Retry delays spread so a failed cohort comes apart */
  it("spreads delays a fifth of the step either side, never on one instant", () => {
    const step = WEBHOOK_RETRY_LADDER_MS[0]!;
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 1, random: () => 0 })).toBe(
      step - step / 5,
    );
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 1, random: () => 1 })).toBe(
      step + step / 5,
    );
    // Distinct draws land on distinct instants: the cohort comes apart.
    const draws = new Set(
      [0.1, 0.35, 0.62, 0.87].map((value) =>
        WebhookDeliveryService.retryDelayMs({ attempt: 1, random: () => value }),
      ),
    );
    expect(draws.size).toBe(4);
    for (const delay of draws) expect(isAround(delay, step)).toBe(true);
  });
});
