import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_CONNECT_REJECTED_PREFIX,
  elevenLabsConvaiTransport,
  readElevenLabsErrorReason,
  wrapConnectRejection,
} from "../elevenlabs-convai.transport";

const CREDENTIAL = {
  apiKey: "sk-secret",
  baseUrl: "https://api.elevenlabs.io",
};

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
  describe("given a connect call that may reject", () => {
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

    describe("when the underlying connect times out", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("calls the adapter's disconnect best-effort, and still rejects with the prefix", async () => {
        const disconnect = vi.fn(async () => {});
        const adapter = {
          connect: () => new Promise<void>(() => {}),
          disconnect,
        };
        const wrapped = wrapConnectRejection(adapter, 20);

        await expect(wrapped.connect()).rejects.toThrow(
          new RegExp(
            `^${ELEVENLABS_CONNECT_REJECTED_PREFIX}: connection timed out`,
          ),
        );
        expect(disconnect).toHaveBeenCalled();
      });

      it("swallows a disconnect failure and keeps the timeout error", async () => {
        const adapter = {
          connect: () => new Promise<void>(() => {}),
          disconnect: async () => {
            throw new Error("already closed");
          },
        };
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
});

describe("readElevenLabsErrorReason", () => {
  describe("given a provider error response body", () => {
    describe("when the body carries a detail object with a message", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("returns the provider's message", () => {
        const body = JSON.stringify({
          detail: {
            type: "authentication_error",
            code: "unauthorized",
            message:
              "The API key you used is missing the permission convai_write to execute this operation.",
            status: "missing_permissions",
          },
        });

        expect(readElevenLabsErrorReason(401, body)).toBe(
          "The API key you used is missing the permission convai_write to execute this operation.",
        );
      });
    });

    describe("when the body carries a plain string detail", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("returns the string", () => {
        const body = JSON.stringify({ detail: "agent not found" });

        expect(readElevenLabsErrorReason(404, body)).toBe("agent not found");
      });
    });

    describe("when the body carries a detail array of validation errors", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("returns the first message", () => {
        const body = JSON.stringify({
          detail: [{ msg: "field required" }, { msg: "second error" }],
        });

        expect(readElevenLabsErrorReason(422, body)).toBe("field required");
      });
    });

    describe("when the body is not JSON", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("falls back to the status code", () => {
        expect(readElevenLabsErrorReason(500, "<html>Bad Gateway</html>")).toBe(
          "Status code: 500",
        );
      });
    });

    describe("when the body is empty", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("falls back to the status code", () => {
        expect(readElevenLabsErrorReason(401, "")).toBe("Status code: 401");
      });
    });
  });
});

describe("elevenLabsConvaiTransport.mintSession", () => {
  describe("given a mint session request", () => {
    afterEach(() => vi.unstubAllGlobals());

    describe("when ElevenLabs returns a signed URL", () => {
      it("returns the signed URL and sends the key only as the auth header", async () => {
        const fetchMock = vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ signed_url: "wss://api.elevenlabs.io/abc" }),
          text: async () => "",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await elevenLabsConvaiTransport.mintSession({
          agentId: "agent_1",
          credential: CREDENTIAL,
        });

        expect(result).toEqual({ signedUrl: "wss://api.elevenlabs.io/abc" });
        const [, init] = fetchMock.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
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

    describe("when ElevenLabs refuses the mint with a missing-permission body", () => {
      /** @scenario "A run with a wrong agent id or a removed key fails without hanging the pool" */
      it("surfaces the provider's message instead of the bare status code", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => ({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            text: async () =>
              JSON.stringify({
                detail: {
                  type: "authentication_error",
                  code: "unauthorized",
                  message:
                    "The API key you used is missing the permission convai_write to execute this operation.",
                  status: "missing_permissions",
                },
              }),
            json: async () => ({}),
          })),
        );

        await expect(
          elevenLabsConvaiTransport.mintSession({
            agentId: "agent_1",
            credential: CREDENTIAL,
          }),
        ).rejects.toThrow(
          `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: The API key you used is missing the permission convai_write to execute this operation.`,
        );
      });
    });

    describe("when ElevenLabs returns a signed URL on a non-wss scheme", () => {
      it("rejects it", async () => {
        mockFetchOnce({
          json: async () => ({ signed_url: "ws://api.elevenlabs.io/abc" }),
        });

        await expect(
          elevenLabsConvaiTransport.mintSession({
            agentId: "agent_1",
            credential: CREDENTIAL,
          }),
        ).rejects.toThrow(
          `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: signed URL rejected`,
        );
      });
    });

    describe("when ElevenLabs returns a signed URL on an unrelated host", () => {
      it("rejects it", async () => {
        mockFetchOnce({
          json: async () => ({ signed_url: "wss://evil.example/abc" }),
        });

        await expect(
          elevenLabsConvaiTransport.mintSession({
            agentId: "agent_1",
            credential: CREDENTIAL,
          }),
        ).rejects.toThrow(
          `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: signed URL rejected`,
        );
      });
    });

    describe("when the signed URL is on api.elevenlabs.io", () => {
      it("accepts it", async () => {
        mockFetchOnce({
          json: async () => ({
            signed_url: "wss://api.elevenlabs.io/v1/convai/abc",
          }),
        });

        const result = await elevenLabsConvaiTransport.mintSession({
          agentId: "agent_1",
          credential: CREDENTIAL,
        });

        expect(result).toEqual({
          signedUrl: "wss://api.elevenlabs.io/v1/convai/abc",
        });
      });
    });

    describe("when the signed URL matches the credential's configured base host", () => {
      it("accepts it", async () => {
        mockFetchOnce({
          json: async () => ({ signed_url: "wss://regional.example.com/abc" }),
        });

        const result = await elevenLabsConvaiTransport.mintSession({
          agentId: "agent_1",
          credential: {
            ...CREDENTIAL,
            baseUrl: "https://regional.example.com",
          },
        });

        expect(result).toEqual({ signedUrl: "wss://regional.example.com/abc" });
      });
    });
  });
});

describe("elevenLabsConvaiTransport.fetchCallRecord", () => {
  describe("given a fetch call record request", () => {
    afterEach(() => vi.unstubAllGlobals());

    describe("when the conversation has no audio", () => {
      /** @scenario "Recording unavailable leaves the transcript without a Play control or an error" */
      it("normalises the transcript with no audio url and no error", async () => {
        mockFetchOnce({
          json: async () => ({
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
          json: async () => ({
            conversation_id: "conv_1",
            has_audio: true,
            transcript: [],
          }),
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
});
