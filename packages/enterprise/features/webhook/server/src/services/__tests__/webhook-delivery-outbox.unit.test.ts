// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How the delivery process asks the outbox to run its sends.
 *
 * The retry ladder, the attempt count and the lease are a delivery promise —
 * "we keep trying for three days, and a slow receiver does not get the same
 * batch twice" — and none of it is in force unless the process manager
 * actually hands the runtime its configuration. It declared one for a while
 * and never passed it, so every send ran on the runtime defaults instead.
 *
 * These cases assert the promise rather than the numbers: that a
 * configuration is handed over at all, that the schedule is the webhook
 * ladder and not the runtime's default, that the ladder and the attempt count
 * together still reach three days, and that the lease outlasts a slow send.
 */

import { describe, expect, it } from "vitest";
import {
  WebhookDeliveryService,
  WEBHOOK_RETRY_LADDER_MS,
  WEBHOOK_SEND_MAX_ATTEMPTS,
} from "../webhook-delivery.service";

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

const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

describe("the webhook delivery process manager's outbox", () => {
  describe("given the process manager is built", () => {
    it("hands the runtime a configuration, rather than leaving sends on the defaults", () => {
      expect(recordedOutboxConfig()).toBeDefined();
    });
  });

  describe("its retry schedule", () => {
    it("is the webhook ladder, not whatever the runtime would have used", () => {
      const retryDelayMs = recordedOutboxConfig()?.retryDelayMs;

      expect(retryDelayMs?.({ attempt: 1 })).toBe(WEBHOOK_RETRY_LADDER_MS[0]);
      expect(retryDelayMs?.({ attempt: WEBHOOK_RETRY_LADDER_MS.length })).toBe(
        WEBHOOK_RETRY_LADDER_MS.at(-1),
      );
    });

    it("holds at the ladder's last step once it runs off the end", () => {
      const retryDelayMs = recordedOutboxConfig()?.retryDelayMs;

      expect(retryDelayMs?.({ attempt: WEBHOOK_SEND_MAX_ATTEMPTS })).toBe(
        WEBHOOK_RETRY_LADDER_MS.at(-1),
      );
    });

    it("keeps trying for three days, which is the promise the ladder was sized for", () => {
      const config = recordedOutboxConfig();
      const attempts = config?.maxAttempts ?? 0;
      const retryDelayMs = config?.retryDelayMs;
      const total = Array.from(
        { length: attempts - 1 },
        (_, index) => retryDelayMs?.({ attempt: index + 1 }) ?? 0,
      ).reduce((sum, delay) => sum + delay, 0);

      expect(total).toBeLessThanOrEqual(THREE_DAYS_MS);
      expect(total).toBeGreaterThan(THREE_DAYS_MS / 2);
    });
  });

  describe("its lease", () => {
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

  describe("its concurrency", () => {
    it("sends more than one batch at a time, because batches are independent", () => {
      expect(recordedOutboxConfig()?.concurrency ?? 0).toBeGreaterThan(1);
    });
  });

  /** @scenario "The retry ladder holds its last attempt inside seventy two hours" */
  it("keeps the cumulative schedule within 72h and settles at 12h", () => {
    let elapsed = 0;
    const delays: number[] = [];
    for (let attempt = 1; attempt < WEBHOOK_SEND_MAX_ATTEMPTS; attempt++) {
      const delay = WebhookDeliveryService.retryDelayMs({ attempt });
      delays.push(delay);
      elapsed += delay;
    }
    // The final retry fires inside 72 hours of the first failure.
    expect(elapsed).toBeLessThanOrEqual(THREE_DAYS_MS);
    // And the ladder is not trivially short: it spans multiple days.
    expect(elapsed).toBeGreaterThan(48 * 60 * 60 * 1000);
    // Cadence settles at 12h once the explicit rungs are exhausted.
    expect(delays.at(-1)).toBe(12 * 60 * 60 * 1000);
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 99 })).toBe(
      12 * 60 * 60 * 1000,
    );
    // The explicit rungs are exactly the documented schedule.
    expect(WEBHOOK_RETRY_LADDER_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 60 * 60_000,
      6 * 60 * 60_000,
      12 * 60 * 60_000,
    ]);
  });
});
