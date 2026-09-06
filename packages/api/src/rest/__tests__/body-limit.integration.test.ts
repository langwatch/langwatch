/**
 * @vitest-environment node
 * Runs the body cap against the exact production wiring over a real
 * socket, since a chunked/no-Content-Length request needs draining and
 * rebuilding, which throws against the platform's own globals — a 500 a
 * store-and-forward assertion would never catch.
 * @see src/server/routes/_lib/body-limit.ts, src/start.ts
 */

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { bodyLimit } from "../body-limit.ts";

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
      /** @scenario "A sender that declares no length is served" */
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
      /** @scenario "An undeclared body is refused once it passes the cap" */
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
      /** @scenario "A sender that declares its length is served" */
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
      /** @scenario "A declared length over the cap is refused before the body is read" */
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

  // Why this module exists at all, rather than hono's. The two differ on
  // exactly one request shape, so without this the whole file would keep
  // passing after someone swapped the import back. If it ever stops failing,
  // hono has fixed the reconstruction upstream and the local copy can go.
  describe("given hono's own body-limit on the same wiring", () => {
    it("answers 500 to the chunked request this module serves", async () => {
      const app = new Hono();
      app.post("/echo", honoBodyLimit({ maxSize: 1024 }), async (c) =>
        c.json({ body: await c.req.text() }),
      );
      server = createServer(
        getRequestListener((request: Request) => app.fetch(request), {
          overrideGlobalObjects: false,
        }),
      );
      const port = await listen(server);

      const response = await fetch(`http://127.0.0.1:${port}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: streamed(JSON.stringify({ resourceSpans: [] })),
        // @ts-expect-error — half-duplex streaming request (undici)
        duplex: "half",
      });

      expect(response.status).toBe(500);
    });
  });
});
