import { DispatchError } from "@langwatch/eventing";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ssrf/fenced-fetch", () => ({ fetchValidatedDestination: vi.fn() }));

import { fetchValidatedDestination } from "../../ssrf/fenced-fetch";
import type { SsrfValidationResult } from "../../ssrf/url-validator";
import { sendHttpDestination } from "../http-destination";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * What the sender does with the ANSWER: the response caps, the teardown, and
 * which failures are worth a retry. The fence itself is stubbed here so the
 * caps can be driven exactly; the real fence, against a real socket, is the
 * sibling `http-destination.network.unit.test.ts`.
 */

type FenceResponse = Awaited<ReturnType<typeof fetchValidatedDestination>>;

const mockedFetch = vi.mocked(fetchValidatedDestination);

const validated: SsrfValidationResult = {
  type: "resolved",
  originalUrl: "https://example.com/hook",
  hostname: "example.com",
  port: 443,
  protocol: "https:",
  path: "/hook",
  resolvedIp: "93.184.216.34",
};

const validateUrl = async () => validated;

const send = (overrides?: { maxResponseBytes?: number }) =>
  sendHttpDestination({
    url: "https://example.com/hook",
    body: "{}",
    contextLabel: "test",
    validateUrl,
    tls: { rejectUnauthorized: true },
    ...overrides,
  });

/** A REAL Response, so `body` is a real stream — the sender reads the stream, not `text()`. */
function fetchResolves(status: number, text: string, headers?: Record<string, string>) {
  mockedFetch.mockResolvedValue(
    new Response(text, { status, headers }) as unknown as FenceResponse,
  );
}

/** A body that never ends — the shape a hostile receiver uses to stream forever. */
function endlessBody(): {
  stream: ReadableStream<Uint8Array>;
  wasCancelled: () => boolean;
} {
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

afterEach(() => vi.clearAllMocks());

describe("sendHttpDestination", () => {
  describe("when the receiver answers", () => {
    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("returns the status and the body", async () => {
      fetchResolves(200, "ok-body");

      await expect(send()).resolves.toMatchObject({ status: 200, body: "ok-body" });
    });

    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("caps an oversized response body at sixty-four kibibytes", async () => {
      fetchResolves(200, "x".repeat(100_000));

      await expect(send()).resolves.toMatchObject({ body: "x".repeat(64 * 1024) });
    });

    /** @scenario "A slow receiver is abandoned at the timeout, retryably" */
    it("bounds the request with a deadline and socket-level backstops", async () => {
      fetchResolves(200, "ok");

      await send();

      const init = mockedFetch.mock.calls[0]![1]!;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headersTimeoutMs).toBe(10_000);
      expect(init.bodyTimeoutMs).toBe(10_000);
      expect(init.followRedirects).toBe(false);
    });

    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("reports the receiver's own back-off when it sent one", async () => {
      fetchResolves(429, "slow down", { "retry-after": "120" });

      await expect(send()).resolves.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    });

    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("keeps an empty snippet when the body cannot be read at all", async () => {
      mockedFetch.mockResolvedValue({
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("stream error"));
          },
        }),
      } as unknown as FenceResponse);

      await expect(send()).resolves.toMatchObject({ status: 200, body: "" });
    });

    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("keeps an empty snippet when there is no body at all", async () => {
      mockedFetch.mockResolvedValue({ status: 204, body: null } as unknown as FenceResponse);

      await expect(send()).resolves.toMatchObject({ status: 204, body: "" });
    });
  });

  describe("when the receiver streams a body that never ends", () => {
    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("stops at the cap and tears the transfer down instead of draining it", async () => {
      const { stream, wasCancelled } = endlessBody();
      mockedFetch.mockResolvedValue({
        status: 200,
        body: stream,
      } as unknown as FenceResponse);

      const result = await send();

      expect(result.body.length).toBe(64 * 1024);
      expect(wasCancelled()).toBe(true);
    });
  });

  describe("when the caller raises the cap to parse a large body", () => {
    /** @scenario "The response body is read only as far as the cap and then cancelled" */
    it("keeps the whole body up to the raised cap and truncates past it", async () => {
      const payload = JSON.stringify({ items: "y".repeat(200_000) });
      fetchResolves(200, payload);

      const parsed = await send({ maxResponseBytes: 1024 * 1024 });
      expect(parsed.body).toBe(payload);

      mockedFetch.mockClear();
      fetchResolves(200, "z".repeat(300_000));
      const truncated = await send({ maxResponseBytes: 128 * 1024 });
      expect(truncated.body.length).toBe(128 * 1024);
    });
  });

  describe("when the request fails before an answer exists", () => {
    /** @scenario "A slow receiver is abandoned at the timeout, retryably" */
    it("classifies a connection failure as retryable", async () => {
      mockedFetch.mockRejectedValue(new Error("ECONNRESET"));

      const error = (await send().catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(true);
      expect(error.message).toContain("test");
    });

    /** @scenario "A send refuses a fenced address before it opens a connection" */
    it.each([
      "URL blocked: resolves to a private IP",
      "Access to cloud metadata endpoints is not allowed for security reasons",
      "Redirects are not followed for this destination — the endpoint must answer directly.",
      "Too many redirects (max 10)",
      "This hostname resolves to a private or localhost IP address, which is not allowed for security reasons",
    ])(
      "classifies the fence refusal %#, which never becomes valid on retry, as terminal",
      async (message) => {
        mockedFetch.mockRejectedValue(new Error(message));

        const error = (await send().catch((err: unknown) => err)) as DispatchError;

        expect(error.retryable).toBe(false);
      },
    );
  });
});
