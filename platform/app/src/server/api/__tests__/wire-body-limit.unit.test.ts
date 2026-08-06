/**
 * @scenario "Chunked request bodies survive the wire byte cap"
 *
 * Regression coverage for the hono `bodyLimit` + @hono/node-server crash:
 * a request WITHOUT Content-Length (chunked transfer — what the OTel JS
 * exporters send) made hono's middleware rebuild the request via
 * `new Request(c.req.raw, …)`, which throws
 * `TypeError: Cannot read private member #state` under @hono/node-server's
 * lightweight request and turned every chunked OTLP export into a 500.
 *
 * The crash only exists over a REAL node socket — hono's `app.request()`
 * test helper builds genuine undici Requests, which never trip the brand
 * check — so these tests serve the app with @hono/node-server on an
 * ephemeral port and speak HTTP to it, executing the exact code path that
 * failed in production. `overrideGlobalObjects: false` matters: it is what
 * `start.ts` passes (deliberately — the process's globals stay untouched),
 * and it is the condition under which hono's middleware crashes. Swapping
 * `wireBodyLimit` back to hono's `bodyLimit` makes the chunked cases here
 * fail with 500.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { wireBodyLimit } from "../wire-body-limit";

const MAX_SIZE = 1024;

let server: ReturnType<typeof serve>;
let baseUrl: string;

beforeAll(async () => {
  const app = new Hono();
  app.post("/guarded", wireBodyLimit({ maxSize: MAX_SIZE }), async (c) => {
    const body = await c.req.text();
    return c.json({ received: body.length });
  });

  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: app.fetch, port: 0, overrideGlobalObjects: false },
      (info) => {
        baseUrl = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    );
  });
});

afterAll(() => {
  server.close();
});

/** POST with a streamed body — node's fetch sends it chunked, no Content-Length. */
const postChunked = (payload: string) => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return fetch(`${baseUrl}/guarded`, {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required by undici for streamed bodies but
    // missing from the DOM RequestInit type.
    duplex: "half",
  });
};

describe("wireBodyLimit over a real @hono/node-server socket", () => {
  describe("when the body is sent chunked (no Content-Length)", () => {
    it("passes a body under the cap through to the handler intact", async () => {
      const res = await postChunked("a".repeat(100));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 100 });
    });

    it("rejects a body over the cap with 413", async () => {
      const res = await postChunked("a".repeat(MAX_SIZE + 1));
      expect(res.status).toBe(413);
    });
  });

  describe("when the body carries a Content-Length", () => {
    it("passes a body under the cap through to the handler", async () => {
      const res = await fetch(`${baseUrl}/guarded`, {
        method: "POST",
        body: "a".repeat(100),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 100 });
    });

    it("rejects a declared length over the cap with 413", async () => {
      const res = await fetch(`${baseUrl}/guarded`, {
        method: "POST",
        body: "a".repeat(MAX_SIZE + 1),
      });
      expect(res.status).toBe(413);
    });
  });
});
