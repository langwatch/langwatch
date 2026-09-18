import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_CONNECT_REJECTED_PREFIX,
  elevenLabsConvaiTransport,
  wrapConnectRejection,
} from "../elevenlabs-convai.transport";

const CREDENTIAL = { apiKey: "sk-secret", baseUrl: "https://api.elevenlabs.io" };

function mockFetchOnce(response: Partial<Response> & { json?: () => unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => response.json?.() ?? {},
      text: async () => "",
      ...response,
    })),
  );
}

describe("wrapConnectRejection", () => {
  describe("when the underlying connect throws", () => {
    it("surfaces the mandated rejection prefix with the reason", async () => {
      const adapter = {
        connect: async () => {
          throw new Error("socket closed 1006");
        },
      };
      const wrapped = wrapConnectRejection(adapter, 1000);

      await expect(wrapped.connect()).rejects.toThrow(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: socket closed 1006`,
      );
    });
  });

  describe("when the underlying connect hangs", () => {
    it("rejects at the timeout rather than hanging", async () => {
      const adapter = { connect: () => new Promise<void>(() => {}) };
      const wrapped = wrapConnectRejection(adapter, 20);

      await expect(wrapped.connect()).rejects.toThrow(
        new RegExp(
          `^${ELEVENLABS_CONNECT_REJECTED_PREFIX}: connection timed out`,
        ),
      );
    });
  });

  describe("when the underlying connect succeeds", () => {
    it("resolves without wrapping", async () => {
      let called = false;
      const adapter = {
        connect: async () => {
          called = true;
        },
      };
      await wrapConnectRejection(adapter, 1000).connect();
      expect(called).toBe(true);
    });
  });
});

describe("elevenLabsConvaiTransport.mintSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("when ElevenLabs returns a signed URL", () => {
    it("returns the signed URL and sends the key only as the auth header", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ signed_url: "wss://signed/abc" }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await elevenLabsConvaiTransport.mintSession({
        agentId: "agent_1",
        credential: CREDENTIAL,
      });

      expect(result).toEqual({ signedUrl: "wss://signed/abc" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(
        CREDENTIAL.apiKey,
      );
    });
  });

  describe("when ElevenLabs refuses the mint", () => {
    it("throws with the rejection prefix", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "bad key",
          json: async () => ({}),
        })),
      );

      await expect(
        elevenLabsConvaiTransport.mintSession({
          agentId: "agent_1",
          credential: CREDENTIAL,
        }),
      ).rejects.toThrow(ELEVENLABS_CONNECT_REJECTED_PREFIX);
    });
  });
});

describe("elevenLabsConvaiTransport.fetchCallRecord", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("when the conversation has no audio", () => {
    /** @scenario "Recording unavailable leaves the transcript without a Play control or an error" */
    it("normalises the transcript with no audio url and no error", async () => {
      mockFetchOnce({
        json: () => ({
          conversation_id: "conv_1",
          has_audio: false,
          metadata: { start_time_unix_secs: 1, call_duration_secs: 3 },
          transcript: [
            { role: "user", message: "hello", time_in_call_secs: 0 },
            { role: "agent", message: "hi", time_in_call_secs: 1 },
          ],
        }),
      });

      const record = await elevenLabsConvaiTransport.fetchCallRecord({
        conversationId: "conv_1",
        credential: CREDENTIAL,
        audioProxyUrl: "/api/voice/session/conv_1/audio",
      });

      expect(record?.audioUrl).toBeUndefined();
      expect(record?.source).toBe("provider");
      expect(record?.turns).toEqual([
        { role: "caller", text: "hello", startMs: 0 },
        { role: "agent", text: "hi", startMs: 1000 },
      ]);
    });
  });

  describe("when the conversation has audio", () => {
    it("points audioUrl at the app proxy, never at ElevenLabs", async () => {
      mockFetchOnce({
        json: () => ({ conversation_id: "conv_1", has_audio: true, transcript: [] }),
      });

      const record = await elevenLabsConvaiTransport.fetchCallRecord({
        conversationId: "conv_1",
        credential: CREDENTIAL,
        audioProxyUrl: "/api/voice/session/conv_1/audio",
      });

      expect(record?.audioUrl).toBe("/api/voice/session/conv_1/audio");
    });
  });

  describe("when the record is not ready yet", () => {
    it("returns null so the caller falls back to the live transcript", async () => {
      mockFetchOnce({ ok: false, status: 404 });
      const record = await elevenLabsConvaiTransport.fetchCallRecord({
        conversationId: "conv_1",
        credential: CREDENTIAL,
        audioProxyUrl: "/api/voice/session/conv_1/audio",
      });
      expect(record).toBeNull();
    });
  });
});
