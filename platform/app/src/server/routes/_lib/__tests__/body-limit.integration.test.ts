/**
 * @vitest-environment node
 *
 * The body cap runs against the EXACT production wiring — `getRequestListener`
 * with `overrideGlobalObjects: false`, from `src/start.ts` — over a real
 * socket, because that wiring is what the middleware has to survive.
 *
 * A request without `Content-Length` can only be measured by draining it, so
 * the body must be handed back to the route afterwards. `hono/body-limit`
 * rebuilds it with `new Request(c.req.raw, init)`, which the global `Request`
 * cannot do to the stand-in `@hono/node-server` supplies while the platform
 * keeps its own globals: it throws, and the route answers 500. Every chunked
 * upload takes that path, including the OTLP exporters posting to
 * `/api/otel/v1/traces`, so the streaming cases below are the ones that matter
 * — a store-and-forward assertion on a `Content-Length` request would pass
 * against the broken middleware.
 *
 * @see src/server/routes/_lib/body-limit.ts
 * @see src/start.ts (honoFetchForNode + getRequestListener wiring)
 */

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { bodyLimit } from "../body-limit";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** The production bridge, fronting a route that echoes back what it read. */
function createEchoServer(maxSize: number): Server {
  const app = new Hono();
  app.post("/echo", bodyLimit({ maxSize }), async (c) => {
    const body = await c.req.text();
    return c.json({ length: body.length, body });
  });

  return createServer(
    getRequestListener((request: Request) => app.fetch(request), {
      overrideGlobalObjects: false,
    }),
  );
}

/** A body delivered as a stream, which makes undici send it chunked. */
function streamed(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

describe("the request body cap behind the Node bridge", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  describe("given a chunked request carrying no Content-Length", () => {
    describe("when the body fits under the cap", () => {
      it("hands the whole body to the route and answers 200", async () => {
        server = createEchoServer(1024);
        const port = await listen(server);

        const payload = JSON.stringify({ resourceSpans: [] });
        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: streamed(payload),
          // @ts-expect-error — half-duplex streaming request (undici)
          duplex: "half",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          length: payload.length,
          body: payload,
        });
      });
    });

    describe("when the body exceeds the cap", () => {
      it("rejects it with 413", async () => {
        server = createEchoServer(16);
        const port = await listen(server);

        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: streamed("x".repeat(256)),
          // @ts-expect-error — half-duplex streaming request (undici)
          duplex: "half",
        });

        expect(response.status).toBe(413);
      });
    });
  });

  describe("given a request that declares its Content-Length", () => {
    describe("when the body fits under the cap", () => {
      it("hands the whole body to the route and answers 200", async () => {
        server = createEchoServer(1024);
        const port = await listen(server);

        const payload = JSON.stringify({ resourceSpans: [] });
        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          length: payload.length,
          body: payload,
        });
      });
    });

    describe("when the declared length exceeds the cap", () => {
      it("rejects it with 413 without reading the body", async () => {
        server = createEchoServer(16);
        const port = await listen(server);

        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "x".repeat(256),
        });

        expect(response.status).toBe(413);
      });
    });
  });
});
