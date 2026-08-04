import { describe, expect, it } from "vitest";
import {
  WEBHOOK_RETRY_LADDER_MS,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  webhookRetryDelayMs,
} from "../process-manager/webhookDelivery.process";

const HOUR = 60 * 60 * 1000;

describe("webhook retry ladder", () => {
  /** @scenario The retry ladder holds its last attempt inside seventy two hours */
  it("keeps the cumulative schedule within 72h and settles at 12h", () => {
    let elapsed = 0;
    const delays: number[] = [];
    for (let attempt = 1; attempt < WEBHOOK_SEND_MAX_ATTEMPTS; attempt++) {
      const delay = webhookRetryDelayMs({ attempt });
      delays.push(delay);
      elapsed += delay;
    }
    // The final retry fires inside 72 hours of the first failure.
    expect(elapsed).toBeLessThanOrEqual(72 * HOUR);
    // And the ladder is not trivially short: it spans multiple days.
    expect(elapsed).toBeGreaterThan(48 * HOUR);
    // Cadence settles at 12h once the explicit rungs are exhausted.
    expect(delays.at(-1)).toBe(12 * HOUR);
    expect(webhookRetryDelayMs({ attempt: 99 })).toBe(12 * HOUR);
    // The explicit rungs are exactly the documented schedule.
    expect(WEBHOOK_RETRY_LADDER_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * HOUR,
      6 * HOUR,
      12 * HOUR,
    ]);
  });
});
