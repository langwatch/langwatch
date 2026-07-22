import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "@langwatch/dispatch-error";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { sendHttpDestination } from "../httpDestination";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));

const mockedFetch = vi.mocked(ssrfSafeFetch);

type MockedResponse = Awaited<ReturnType<typeof ssrfSafeFetch>>;

/**
 * A REAL Response, so `body` is a real ReadableStream — the primitive reads the
 * stream, not `text()`, and a mock that only stubs `text()` would hide that.
 */
function fetchResolves(status: number, text: string) {
  mockedFetch.mockResolvedValue(
    new Response(text, { status }) as unknown as MockedResponse,
  );
}

/** A body that never ends — the shape a hostile endpoint uses to stream forever. */
function endlessBody(): { stream: ReadableStream<Uint8Array>; wasCancelled: () => boolean } {
  let cancelled = false;
  const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, wasCancelled: () => cancelled };
}

const send = (overrides?: { maxResponseBytes?: number }) =>
  sendHttpDestination({
    url: "https://example.com/hook",
    body: "{}",
    contextLabel: "test",
    ...overrides,
  });

afterEach(() => vi.clearAllMocks());

describe("sendHttpDestination", () => {
  describe("when the endpoint responds", () => {
    it("returns the status and body", async () => {
      fetchResolves(200, "ok-body");
      await expect(send()).resolves.toMatchObject({ status: 200, body: "ok-body" });
    });

    it("caps an oversized response body", async () => {
      fetchResolves(200, "x".repeat(100_000));
      const res = await send();
      expect(res.body.length).toBe(64 * 1024);
    });

    it("bounds the request with a timeout and socket-level backstops", async () => {
      fetchResolves(200, "ok");
      await send();

      const init = mockedFetch.mock.calls[0]![1]!;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headersTimeoutMs).toBe(10_000);
      expect(init.bodyTimeoutMs).toBe(10_000);
    });

    it("returns an empty snippet when the body can't be read", async () => {
      mockedFetch.mockResolvedValue({
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("stream error"));
          },
        }),
      } as unknown as MockedResponse);
      await expect(send()).resolves.toMatchObject({ status: 200, body: "" });
    });

    it("returns an empty snippet when there is no body at all (204)", async () => {
      mockedFetch.mockResolvedValue({
        status: 204,
        body: null,
      } as unknown as MockedResponse);
      await expect(send()).resolves.toMatchObject({ status: 204, body: "" });
    });
  });

  describe("when the endpoint streams a body that never ends", () => {
    it("stops at the cap and cancels the transfer instead of buffering it all", async () => {
      const { stream, wasCancelled } = endlessBody();
      mockedFetch.mockResolvedValue({
        status: 200,
        body: stream,
      } as unknown as MockedResponse);

      const res = await send();

      expect(res.body.length).toBe(64 * 1024);
      expect(wasCancelled()).toBe(true);
    });
  });

  describe("when the caller raises maxResponseBytes to parse a large body", () => {
    it("keeps the whole body up to the raised cap", async () => {
      const payload = JSON.stringify({ items: "y".repeat(200_000) });
      fetchResolves(200, payload);

      const res = await send({ maxResponseBytes: 1024 * 1024 });

      expect(res.body).toBe(payload);
      expect(() => JSON.parse(res.body)).not.toThrow();
    });

    it("still truncates past the raised cap", async () => {
      fetchResolves(200, "z".repeat(300_000));
      const res = await send({ maxResponseBytes: 128 * 1024 });
      expect(res.body.length).toBe(128 * 1024);
    });
  });

  describe("when the request fails at the transport", () => {
    it("throws retryable on a connection error", async () => {
      mockedFetch.mockRejectedValue(new Error("ECONNRESET"));
      const err = (await send().catch((e) => e)) as DispatchError;
      expect(err).toBeInstanceOf(DispatchError);
      expect(err.retryable).toBe(true);
    });

    it("throws terminal when the URL is SSRF-blocked", async () => {
      mockedFetch.mockRejectedValue(
        new Error("URL blocked: resolves to a private IP"),
      );
      const err = (await send().catch((e) => e)) as DispatchError;
      expect(err.retryable).toBe(false);
    });
  });
});
