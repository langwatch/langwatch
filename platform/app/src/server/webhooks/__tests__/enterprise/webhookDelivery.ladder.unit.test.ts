import { describe, expect, it } from "vitest";
import {
  deliverSchema,
  WEBHOOK_RETRY_LADDER_MS,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  webhookRetryDelayMs,
} from "~/runtime/app/features/webhooks";

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

describe("the deliver intent payload", () => {
  const frozenBeforeAudioQuantities = {
    gateway_request_id: "req_old",
    project_id: "proj_1",
    status: "confirmed" as const,
    occurred_at: 1_753_800_000_000,
    attribution: null,
    model: "gpt-x",
    model_provider_id: "mp_1",
    usage: {
      input_tokens: 869,
      output_tokens: 207,
      cache_read_input_tokens: 11,
      cache_creation_input_tokens: 5,
      reasoning_tokens: 0,
    },
    cost_nano_usd: 3_500,
    rate_version: "catalog@2026-07-30",
    duration_ms: 120,
    error: null,
    settle_reason: null,
  };

  /** @scenario A quantity added to the vocabulary defaults on records written before it */
  it("reads an outbox row frozen before the audio quantities existed", () => {
    // Without the defaults this row fails to parse on every one of its
    // attempts and the delivery is lost, not delayed.
    const parsed = deliverSchema.parse(frozenBeforeAudioQuantities);

    expect(parsed.usage).toMatchObject({
      input_tokens: 869,
      input_chars: 0,
      audio_ms: 0,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      cache_creation_1h_tokens: 0,
    });
  });

  it("keeps the quantities a current row carries", () => {
    const parsed = deliverSchema.parse({
      ...frozenBeforeAudioQuantities,
      usage: {
        ...frozenBeforeAudioQuantities.usage,
        input_chars: 4000,
        audio_ms: 1234,
      },
    });

    expect(parsed.usage).toMatchObject({ input_chars: 4000, audio_ms: 1234 });
  });
});
