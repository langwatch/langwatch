/**
 * @see specs/features/agents/voice-phone.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TwilioCredential } from "~/server/gateway/twilioCredential.service";
import { resolveTwilioRecordingWavUrl } from "../twilio-recording.service";
import { VOICE_HTTP_TIMEOUT_MS } from "../voice-limits";

const CREDENTIAL: TwilioCredential = {
  accountSid: "AC123",
  authToken: "tok-secret",
  fromNumber: "+14155550000",
};

describe("resolveTwilioRecordingWavUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("when the upstream withholds response headers past the timeout", () => {
    it("aborts the fetch and returns null rather than hanging indefinitely", async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      );

      const promise = resolveTwilioRecordingWavUrl({
        credential: CREDENTIAL,
        callSid: "CA1",
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(VOICE_HTTP_TIMEOUT_MS);

      await expect(promise).resolves.toBeNull();
    });
  });
});
