/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyAudioStream } from "../audio-proxy-stream";
import { VoiceRecordingUnavailableError } from "../voice-session.service";

/** A minimal upstream stand-in with the three fields the proxy reads. */
const okUpstream = (contentType: string | null) => ({
  ok: true,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  headers: {
    get: (name: string) =>
      name.toLowerCase() === "content-type" ? contentType : null,
  },
});

describe("proxyAudioStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("when forceContentType is set", () => {
    it("labels the response with the forced type and ignores the untrusted upstream", async () => {
      // The provider base URL is customer-configured, so an attacker could
      // return `text/html`; forcing the type is what stops it reaching our
      // origin as an XSS vector.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => okUpstream("text/html")),
      );

      const response = await proxyAudioStream({
        signal: new AbortController().signal,
        url: "https://provider.example/v1/audio",
        headers: {},
        fallbackContentType: "audio/mpeg",
        forceContentType: "audio/mpeg",
      });

      expect(response.headers.get("content-type")).toBe("audio/mpeg");
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
        proxyAudioStream({
          signal: controller.signal,
          url: "https://provider.example/v1/audio",
          headers: {},
          fallbackContentType: "audio/mpeg",
        }),
      ).rejects.toBeInstanceOf(VoiceRecordingUnavailableError);
    });
  });
});
