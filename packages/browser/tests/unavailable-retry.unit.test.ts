import { createTRPCUntypedClient, httpLink, TRPCClientError } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";

import { UNAVAILABLE_MAX_ATTEMPTS, unavailableRetryFetch } from "../src/wire/unavailable-retry.ts";

// Spelled out, as packages/process/src/__tests__/server.unit.test.ts asserts it, so a
// rename on either side fails a test.
const shuttingDown = (headers: Record<string, string> = {}) =>
  new Response("langwatch-api is shutting down", {
    status: 503,
    headers: { "Content-Type": "text/plain", "x-langwatch-not-handled": "draining", ...headers },
  });
const answer = () =>
  new Response(JSON.stringify({ result: { data: { ok: true } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const noWait = () => Promise.resolve();

describe("unavailableRetryFetch", () => {
  describe("given the API answers a plain-text 503 once", () => {
    /** @scenario "A call refused by a process that is shutting down is sent again" */
    it("sends the call again and returns the second answer", async () => {
      const send = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(shuttingDown())
        .mockResolvedValueOnce(answer());

      const response = await unavailableRetryFetch({ fetch: send, sleep: noWait })(
        "/api/trpc/trace.list",
      );

      expect(send).toHaveBeenCalledTimes(2);
      expect(await response.json()).toEqual({ result: { data: { ok: true } } });
    });
  });

  describe("given the 503 names a Retry-After", () => {
    /** @scenario "The wait between attempts follows the API's Retry-After" */
    it("waits that long before the next attempt", async () => {
      const sleep = vi.fn(noWait);
      const send = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(shuttingDown({ "Retry-After": "2" }))
        .mockResolvedValueOnce(answer());

      await unavailableRetryFetch({ fetch: send, sleep })("/api/trpc/trace.list");

      expect(sleep).toHaveBeenCalledWith(2_000);
    });
  });

  describe("given the API keeps answering a plain-text 503", () => {
    /** @scenario "A process that stays unavailable reads as a 503 error, not broken JSON" */
    it("hands tRPC an error with status 503 and the API's sentence", async () => {
      const send = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(shuttingDown()));
      const client = createTRPCUntypedClient({
        links: [
          httpLink({
            url: "http://localhost/api/trpc",
            fetch: unavailableRetryFetch({ fetch: send, sleep: noWait }),
          }),
        ],
      });

      const failure = await client.query("trace.list").catch((error: unknown) => error);

      expect(send).toHaveBeenCalledTimes(UNAVAILABLE_MAX_ATTEMPTS);
      expect(failure).toBeInstanceOf(TRPCClientError);
      expect((failure as TRPCClientError<never>).data).toMatchObject({ httpStatus: 503 });
      expect((failure as Error).message).toBe("langwatch-api is shutting down");
    });
  });

  describe("given a handler answers a JSON 503", () => {
    /** @scenario "A JSON 503 from a handler is passed through untouched" */
    it("sends the call once and returns that answer", async () => {
      const handlerAnswer = new Response(JSON.stringify({ error: { code: -32603 } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
      const send = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(handlerAnswer);

      const response = await unavailableRetryFetch({ fetch: send, sleep: noWait })(
        "/api/trpc/trace.list",
      );

      expect(send).toHaveBeenCalledTimes(1);
      expect(response).toBe(handlerAnswer);
    });
  });

  describe("given a proxy answers a plain-text 503 with no marker", () => {
    /** @scenario "A plain-text 503 that may have reached a handler is never resent" */
    it("sends the call once and hands tRPC a 503 error", async () => {
      const send = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        new Response("upstream timed out", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      );
      const client = createTRPCUntypedClient({
        links: [
          httpLink({
            url: "http://localhost/api/trpc",
            fetch: unavailableRetryFetch({ fetch: send, sleep: noWait }),
          }),
        ],
      });

      const failure = await client.mutation("trace.update").catch((error: unknown) => error);

      expect(send).toHaveBeenCalledTimes(1);
      expect((failure as TRPCClientError<never>).data).toMatchObject({ httpStatus: 503 });
      expect((failure as Error).message).toBe("upstream timed out");
    });

    /** @scenario "A plain-text 503 that may have reached a handler is never resent" */
    it("reads the media type whatever its case", async () => {
      const send = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        new Response("upstream timed out", {
          status: 503,
          headers: { "Content-Type": "Text/Plain; charset=utf-8" },
        }),
      );

      const response = await unavailableRetryFetch({ fetch: send, sleep: noWait })(
        "/api/trpc/trace.list",
      );

      expect(send).toHaveBeenCalledTimes(1);
      expect(response.headers.get("content-type")).toBe("application/json");
    });
  });
});
