/** @see modules/gateway/specs/gateway-realtime-session-metering.feature */
import { describe, expect, it } from "vitest";

import {
  estimateUnreportedRealtimeUsage,
  isEmptyRealtimeUsage,
  realtimeReportSpendRecordId,
  remainingRealtimeUsage,
  sanitiseRealtimeReportKey,
  sumRealtimeUsage,
} from "../gateway-realtime-session-metering.rules.ts";
import { EMPTY_SPEND_USAGE } from "../gateway-spend-projection.rules.ts";

const MINTED_AT_MS = 1_800_000_000_000;

/** The estimate for a kind, or null where the kind has no rule. */
function estimate(kind: string | null, credentialLifetimeMs: number | null = null) {
  const result = estimateUnreportedRealtimeUsage({
    kind,
    mintedAtMs: MINTED_AT_MS,
    credentialExpiresAtMs:
      credentialLifetimeMs === null ? null : MINTED_AT_MS + credentialLifetimeMs,
  });

  return result.estimated ? { usage: result.usage, durationMs: result.durationMs } : null;
}

describe("a realtime report key", () => {
  /** @scenario "A report key is reduced to the characters a spend record id may carry" */
  it("keeps letters, digits, underscore and hyphen and is cut at 128 characters", () => {
    expect(sanitiseRealtimeReportKey({ reportKey: "resp_1.a/b c-2" })).toBe("resp_1abc-2");
    expect(sanitiseRealtimeReportKey({ reportKey: "x".repeat(300) })).toHaveLength(128);
  });

  it("answers an empty key when no character can be kept", () => {
    expect(sanitiseRealtimeReportKey({ reportKey: "../.." })).toBe("");
  });

  it("joins the session and the key into the spend record id", () => {
    expect(realtimeReportSpendRecordId({ sessionId: "sess-1", reportKey: "resp_1" })).toBe(
      "sess-1.resp_1",
    );
  });
});

describe("summing and subtracting usage", () => {
  it("adds every quantity across reports", () => {
    const total = sumRealtimeUsage({
      usages: [
        { input_tokens: 10, input_audio_tokens: 100 },
        { input_tokens: 5, output_audio_tokens: 40, audio_ms: 2000 },
      ],
    });

    expect(total).toEqual({
      ...EMPTY_SPEND_USAGE,
      input_tokens: 15,
      input_audio_tokens: 100,
      output_audio_tokens: 40,
      audio_ms: 2000,
    });
  });

  it("leaves what the reports did not record, never below zero", () => {
    const remainder = remainingRealtimeUsage({
      total: { input_tokens: 100, output_tokens: 20 },
      reported: { ...EMPTY_SPEND_USAGE, input_tokens: 60, output_tokens: 50 },
    });

    expect(remainder).toEqual({ ...EMPTY_SPEND_USAGE, input_tokens: 40, output_tokens: 0 });
  });

  it("tells a usage that measured nothing from one that measured something", () => {
    expect(isEmptyRealtimeUsage({ usage: {} })).toBe(true);
    expect(isEmptyRealtimeUsage({ usage: { audio_ms: 1 } })).toBe(false);
  });
});

describe("the estimate for a session that never reported", () => {
  /** @scenario "The estimate follows the session's kind and its credential's lifetime" */
  it("charges each kind by its own rule over the assumed call", () => {
    expect(estimate("realtime")).toEqual({
      durationMs: 600_000,
      usage: { ...EMPTY_SPEND_USAGE, input_audio_tokens: 6000, output_audio_tokens: 6000 },
    });
    expect(estimate("live")?.usage).toEqual({ ...EMPTY_SPEND_USAGE, audio_ms: 600_000 });
    expect(estimate("stt_socket")?.usage).toEqual({ ...EMPTY_SPEND_USAGE, audio_ms: 300_000 });
    expect(estimate("stt_batch")?.usage).toEqual({ ...EMPTY_SPEND_USAGE, audio_ms: 300_000 });
    expect(estimate("tts_socket")?.usage).toEqual({ ...EMPTY_SPEND_USAGE, input_chars: 4500 });
  });

  it("assumes the credential's lifetime when it is known", () => {
    expect(estimate("realtime", 120_000)).toEqual({
      durationMs: 120_000,
      usage: { ...EMPTY_SPEND_USAGE, input_audio_tokens: 1200, output_audio_tokens: 1200 },
    });
  });

  it("never assumes a call under a minute or over an hour", () => {
    expect(estimate("live", 5_000)?.durationMs).toBe(60_000);
    expect(estimate("live", 5 * 60 * 60_000)?.durationMs).toBe(60 * 60_000);
  });

  it("estimates nothing for a kind with no rule", () => {
    expect(estimate("convai")).toBeNull();
    expect(estimate(null)).toBeNull();
    expect(estimate("something_new")).toBeNull();
  });
});
