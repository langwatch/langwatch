import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import { sendHttpDestination } from "../httpDestination";
import { postSlackChatMessage } from "../slackWebApi";

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
