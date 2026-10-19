/**
 * @see specs/features/agents/voice-phone.feature
 */

import { VOICE_HTTP_TIMEOUT_MS } from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpVoiceRecordingChannel } from "../http.voice-recording.channel.ts";

const CREDENTIAL = {
  accountSid: "AC123",
  authToken: "tok-secret",
};

const getTwilioRecordingWavUrl = (
  input: Parameters<HttpVoiceRecordingChannel["getTwilioRecordingWavUrl"]>[0],
) => HttpVoiceRecordingChannel.create().getTwilioRecordingWavUrl(input);

describe("HttpVoiceRecordingChannel.getTwilioRecordingWavUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("when the upstream withholds response headers past the timeout", () => {
    it("aborts the fetch and rejects rather than hanging indefinitely", async () => {
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

      const promise = getTwilioRecordingWavUrl({
        credential: CREDENTIAL,
        callSid: "CA1",
        signal: new AbortController().signal,
      });

      const rejection = promise.then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(VOICE_HTTP_TIMEOUT_MS);

      expect(await rejection).toMatchObject({ name: "AbortError" });
    });
  });

  describe("when the caller's signal is already aborted before the fetch starts", () => {
    it("rejects promptly instead of waiting for the timeout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              if (init.signal?.aborted) {
                reject(new DOMException("aborted", "AbortError"));
                return;
              }
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      );

      const controller = new AbortController();
      controller.abort();

      await expect(
        getTwilioRecordingWavUrl({
          credential: CREDENTIAL,
          callSid: "CA1",
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("when Twilio lists no recording for the call yet", () => {
    it("throws the recording-unavailable error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ recordings: [] })),
      );

      await expect(
        getTwilioRecordingWavUrl({
          credential: CREDENTIAL,
          callSid: "CA1",
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: "voice_recording_unavailable" });
    });
  });

  describe("when Twilio refuses the listing with a server error", () => {
    it("propagates the failure instead of reading it as not ready", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("down", { status: 503 })),
      );

      const failure = await getTwilioRecordingWavUrl({
        credential: CREDENTIAL,
        callSid: "CA1",
        signal: new AbortController().signal,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toMatchObject({ code: "voice_recording_unavailable" });
    });
  });

  describe("when a recording is opened with a caller signal already aborted", () => {
    it("rejects promptly instead of waiting for the timeout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              if (init.signal?.aborted) {
                reject(new DOMException("aborted", "AbortError"));
                return;
              }
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      );

      const controller = new AbortController();
      controller.abort();

      await expect(
        HttpVoiceRecordingChannel.create().open({
          signal: controller.signal,
          url: "https://provider.example/v1/audio",
          headers: {},
          mediaType: "audio/mpeg",
        }),
      ).rejects.toMatchObject({ code: "voice_recording_unavailable" });
    });
  });
});
