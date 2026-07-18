import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { sendHttpDestination } from "../httpDestination";
import { listSlackChannels, postSlackChatMessage } from "../slackWebApi";

vi.mock("../httpDestination", () => ({ sendHttpDestination: vi.fn() }));

const mockedSend = vi.mocked(sendHttpDestination);

function respond(status: number, body: unknown) {
  mockedSend.mockResolvedValue({
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const call = () =>
  postSlackChatMessage({
    token: "xoxb-test",
    channel: "C123",
    payload: { blocks: [{ type: "section" }] },
    triggerName: "My alert",
  });

afterEach(() => vi.clearAllMocks());

describe("postSlackChatMessage", () => {
  describe("when Slack accepts the message", () => {
    it("resolves and sends channel + payload with a bearer token via the shared HTTP primitive", async () => {
      respond(200, { ok: true });
      await expect(call()).resolves.toBeUndefined();

      const req = mockedSend.mock.calls[0]![0];
      expect(req.url).toBe("https://slack.com/api/chat.postMessage");
      expect(req.headers).toMatchObject({ Authorization: "Bearer xoxb-test" });
      expect(JSON.parse(req.body!)).toEqual({
        channel: "C123",
        blocks: [{ type: "section" }],
      });
    });
  });

  describe("when Slack rejects the blocks (200 body, ok:false)", () => {
    it("throws non-retryable and surfaces the block error detail", async () => {
      respond(200, {
        ok: false,
        error: "invalid_blocks",
        response_metadata: { messages: ["invalid block type: data_table"] },
      });
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
      expect((err as Error).message).toContain("invalid_blocks");
      expect((err as Error).message).toContain("data_table");
    });
  });

  describe("when Slack rate-limits (ok:false, rate_limited)", () => {
    it("throws retryable", async () => {
      respond(200, { ok: false, error: "rate_limited" });
      expect(((await call().catch((e) => e)) as DispatchError).retryable).toBe(
        true,
      );
    });
  });

  describe("when a bad token is used (ok:false, invalid_auth)", () => {
    it("throws non-retryable", async () => {
      respond(200, { ok: false, error: "invalid_auth" });
      expect(((await call().catch((e) => e)) as DispatchError).retryable).toBe(
        false,
      );
    });
  });

  describe("when the transport returns 5xx / 429", () => {
    it("throws retryable on 500", async () => {
      respond(500, "");
      expect(((await call().catch((e) => e)) as DispatchError).retryable).toBe(
        true,
      );
    });
    it("throws retryable on 429", async () => {
      respond(429, "");
      expect(((await call().catch((e) => e)) as DispatchError).retryable).toBe(
        true,
      );
    });
  });

  describe("when the shared primitive throws a transport error", () => {
    it("propagates the DispatchError", async () => {
      mockedSend.mockRejectedValue(
        new DispatchError({ message: "connection reset", retryable: true }),
      );
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });
});

/** One conversations.list page: `count` channels and an optional next cursor. */
function channelPage({
  ids,
  nextCursor,
}: {
  ids: string[];
  nextCursor?: string;
}) {
  return {
    ok: true,
    channels: ids.map((id) => ({ id, name: id.toLowerCase(), is_private: false })),
    response_metadata: nextCursor ? { next_cursor: nextCursor } : {},
  };
}

const bodyParams = (callIndex: number) =>
  new URLSearchParams(mockedSend.mock.calls[callIndex]![0].body!);

describe("listSlackChannels", () => {
  describe("when the app has the channels:read scope", () => {
    it("returns the channels sorted by name", async () => {
      respond(200, {
        ok: true,
        channels: [
          { id: "C2", name: "random", is_private: false },
          { id: "C1", name: "alerts", is_private: false },
          { id: "C3", name: "ops-private", is_private: true },
        ],
      });
      const result = await listSlackChannels("xoxb-test");
      expect(result.error).toBeNull();
      expect(result.channels.map((c) => c.name)).toEqual([
        "alerts",
        "ops-private",
        "random",
      ]);
      expect(result.channels[1]).toMatchObject({ id: "C3", isPrivate: true });
    });

    it("asks for a body cap large enough to parse a full page of channels", async () => {
      respond(200, { ok: true, channels: [] });
      await listSlackChannels("xoxb-test");

      const request = mockedSend.mock.calls[0]![0];
      // A page of ~200 entries at ~1.5 KB each blows straight past the shared
      // 64 KiB default, and a truncated body is not parseable JSON.
      expect(request.maxResponseBytes).toBeGreaterThan(300 * 1024);
      expect(Number(bodyParams(0).get("limit"))).toBeLessThanOrEqual(200);
    });
  });

  describe("when the workspace spans several cursor pages", () => {
    it("walks every page and returns the union of them", async () => {
      mockedSend
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(
            channelPage({ ids: ["C1", "C2"], nextCursor: "cursor-2" }),
          ),
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(
            channelPage({ ids: ["C3"], nextCursor: "cursor-3" }),
          ),
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(channelPage({ ids: ["C4"] })),
        });

      const result = await listSlackChannels("xoxb-test");

      expect(mockedSend).toHaveBeenCalledTimes(3);
      expect(result.error).toBeNull();
      expect(result.channels.map((c) => c.id)).toEqual([
        "C1",
        "C2",
        "C3",
        "C4",
      ]);
    });

    it("sends the cursor Slack handed back on the next request", async () => {
      mockedSend
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(
            channelPage({ ids: ["C1"], nextCursor: "dGVhbTpDMDYx" }),
          ),
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(channelPage({ ids: ["C2"] })),
        });

      await listSlackChannels("xoxb-test");

      expect(bodyParams(0).get("cursor")).toBeNull();
      expect(bodyParams(1).get("cursor")).toBe("dGVhbTpDMDYx");
    });

    it("stops at the page cap rather than spinning on an endless cursor", async () => {
      mockedSend.mockResolvedValue({
        status: 200,
        body: JSON.stringify(
          channelPage({ ids: ["C1"], nextCursor: "never-ends" }),
        ),
      });

      const result = await listSlackChannels("xoxb-test");

      expect(mockedSend.mock.calls.length).toBeLessThanOrEqual(10);
      expect(result.channels.length).toBe(mockedSend.mock.calls.length);
    });

    it("keeps the pages it already gathered when a later page fails", async () => {
      mockedSend
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify(
            channelPage({ ids: ["C1"], nextCursor: "cursor-2" }),
          ),
        })
        .mockRejectedValueOnce(
          new DispatchError({ message: "timeout", retryable: true }),
        );

      const result = await listSlackChannels("xoxb-test");

      expect(result.channels.map((c) => c.id)).toEqual(["C1"]);
      expect(result.error).toBe("request_failed");
    });
  });

  describe("when the response body is not parseable JSON", () => {
    it("returns a bad_response error instead of throwing", async () => {
      // What a mid-string truncation actually looks like on the wire.
      respond(200, '{"ok":true,"channels":[{"id":"C1","na');

      const result = await listSlackChannels("xoxb-test");

      expect(result).toEqual({ channels: [], error: "bad_response" });
    });
  });

  describe("when the scope is missing", () => {
    it("surfaces the error only when even public-only is refused", async () => {
      // Both the public+private attempt and the public-only retry are refused —
      // the app is missing channels:read entirely.
      respond(200, { ok: false, error: "missing_scope" });
      const result = await listSlackChannels("xoxb-test");
      expect(result).toEqual({ channels: [], error: "missing_scope" });
    });

    it("falls back to public channels when only groups:read is missing", async () => {
      // First (public+private) is refused for lack of groups:read; the retry
      // asks for public channels only, which channels:read alone can serve.
      mockedSend
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify({ ok: false, error: "missing_scope" }),
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify({
            ok: true,
            channels: [{ id: "C1", name: "alerts", is_private: false }],
          }),
        });

      const result = await listSlackChannels("xoxb-test");

      expect(result.error).toBeNull();
      expect(result.channels.map((c) => c.id)).toEqual(["C1"]);
      expect(bodyParams(0).get("types")).toBe(
        "public_channel,private_channel",
      );
      expect(bodyParams(1).get("types")).toBe("public_channel");
    });
  });

  describe("when the request fails at the transport", () => {
    it("returns a request_failed error", async () => {
      mockedSend.mockRejectedValue(
        new DispatchError({ message: "timeout", retryable: true }),
      );
      expect(await listSlackChannels("xoxb-test")).toEqual({
        channels: [],
        error: "request_failed",
      });
    });
  });
});
