/**
 * @vitest-environment node
 *
 * Regression guard: the Node→Hono bridge must pass STREAMING request bodies
 * through incrementally, not store-and-forward them.
 *
 * Bug: the old hand-rolled bridge (`routeThroughHono`) did `await readBody(req)`
 * for every non-GET request — the ENTIRE body was buffered before Hono ever
 * ran. The Langy frame relay (`POST /api/internal/langy/relay/frames`, ndjson)
 * is a long-lived connection whose route reads line by line while the turn
 * runs; with the buffered bridge every frame of a turn (tokens, tool cards,
 * heartbeats) arrived in ONE burst milliseconds after the turn ended, so
 * nothing ever streamed live.
 *
 * Fix: the entry now mounts `@hono/node-server`'s `getRequestListener` (which
 * hands Hono the Node request as a live stream) wrapped by `honoFetchForNode`.
 * This test drives that EXACT production wiring over a real socket: POST an
 * ndjson body in two delayed chunks and assert the route handler observes the
 * FIRST line before the SECOND chunk is even sent. A buffered bridge only
 * invokes Hono after the request ends, so both lines would land after the
 * "second chunk sent" marker and the ordering assertion fails.
 *
 * @see src/start.ts (honoFetchForNode + getRequestListener wiring)
 * @see src/server/routes/langy-relay.ts (the incremental line reader)
 * @see specs/langy/langy-dual-stream.feature
 */

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `predicate` holds, bounded so a buffered bridge fails, not hangs. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await wait(10);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("the Node→Hono bridge with streaming request bodies", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  describe("given an ndjson relay-style connection whose body arrives in delayed chunks", () => {
    describe("when the first chunk is pushed while the connection stays open", () => {
      it("hands the first line to the route handler before the second chunk is sent", async () => {
        const { honoFetchForNode } = await import("~/start");

        // The observer: an incremental ndjson line reader, the same read loop
        // the real relay route runs. Every handled line and every test-side
        // marker land in ONE ordered log so buffering shows up as reordering.
        const events: string[] = [];
        const app = new Hono();
        app.post("/api/internal/langy/relay/frames", async (c) => {
          const body = c.req.raw.body;
          if (!body) return c.json({ error: "missing body" }, 400);
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, nl).trim();
              pending = pending.slice(nl + 1);
              if (line) events.push(`handled:${line}`);
            }
          }
          return c.json({ ok: true });
        });

        // The EXACT production wiring from src/start.ts.
        server = createServer(
          getRequestListener(honoFetchForNode(app), {
            overrideGlobalObjects: false,
          }),
        );
        const port = await listen(server);

        // A streaming request body we feed chunk by chunk.
        let feed!: ReadableStreamDefaultController<Uint8Array>;
        const requestBody = new ReadableStream<Uint8Array>({
          start(controller) {
            feed = controller;
          },
        });
        const encoder = new TextEncoder();

        const responsePromise = fetch(
          `http://127.0.0.1:${port}/api/internal/langy/relay/frames`,
          {
            method: "POST",
            headers: { "content-type": "application/x-ndjson" },
            body: requestBody,
            // @ts-expect-error — half-duplex streaming request (undici)
            duplex: "half",
          },
        );

        feed.enqueue(encoder.encode('{"frame":1}\n'));
        // A streaming bridge delivers chunk 1 to the handler while the
        // connection is still open; a buffered bridge delivers NOTHING until
        // the body ends, so this wait expires and the ordering below fails.
        await waitUntil(() => events.includes('handled:{"frame":1}'));

        events.push("second-chunk-sent");
        feed.enqueue(encoder.encode('{"frame":2}\n'));
        feed.close();

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });

        expect(events).toEqual([
          'handled:{"frame":1}',
          "second-chunk-sent",
          'handled:{"frame":2}',
        ]);
      });
    });
  });

  describe("given a regular buffered-read route", () => {
    describe("when its body arrives in two chunks", () => {
      it("still delivers the whole body to the handler", async () => {
        const { honoFetchForNode } = await import("~/start");

        let seenBody = "";
        const app = new Hono();
        app.post("/api/echo", async (c) => {
          seenBody = await c.req.text();
          return c.json({ ok: true });
        });

        server = createServer(
          getRequestListener(honoFetchForNode(app), {
            overrideGlobalObjects: false,
          }),
        );
        const port = await listen(server);

        let feed!: ReadableStreamDefaultController<Uint8Array>;
        const requestBody = new ReadableStream<Uint8Array>({
          start(controller) {
            feed = controller;
          },
        });
        const encoder = new TextEncoder();

        const responsePromise = fetch(`http://127.0.0.1:${port}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
          // @ts-expect-error — half-duplex streaming request (undici)
          duplex: "half",
        });

        feed.enqueue(encoder.encode('{"a":'));
        await wait(20);
        feed.enqueue(encoder.encode("1}"));
        feed.close();

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(seenBody).toBe('{"a":1}');
      });
    });
  });
});
