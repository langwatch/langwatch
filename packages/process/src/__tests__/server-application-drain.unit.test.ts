import type http from "node:http";
import type { AddressInfo } from "node:net";

import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it } from "vitest";

import { HTTP_DRAIN_GRACE_MS } from "../lifecycle/shutdown-deadline.ts";
import { Server } from "../server.ts";

const { logger, lines } = createTestLogger();
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
  lines.length = 0;
});

function portOf(server: Server): number {
  const address = server.healthAddress as AddressInfo | null;
  if (address === null || typeof address === "string") throw new Error("no IP port bound");
  return address.port;
}

/** A served application whose one request holds until released, recording what it saw. */
async function serverWithHeldRequest(events: string[]) {
  const server = Server.create({ name: "test-server", logger, ownsProcess: false });
  activeServers.push(server);
  server.with({
    name: "stores",
    stopping: () => events.push("stores stopping"),
    stop: () => {
      events.push("stores stopped");
    },
  });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => undefined;
  const handlerEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await server.serve({
    name: "app",
    start: () => undefined,
    stop: () => {
      events.push("runtime stopped");
    },
    handler: async (request: http.IncomingMessage, response: http.ServerResponse) => {
      if (request.url === "/stream") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(": open\n\n");
        entered();
        // A stream's handler may never settle; the drain closes the stream without waiting on it.
        await new Promise(() => undefined);
        return;
      }
      if (request.url === "/unwinds") {
        entered();
        // Stands in for a handler whose request signal aborts when its response is cut.
        await new Promise((resolve) => response.once("close", resolve));
        await new Promise((resolve) => setTimeout(resolve, 100));
        events.push("handler unwound");
        return;
      }
      if (request.url !== "/slow") {
        response.writeHead(200).end("fast");
        return;
      }
      entered();
      await held;
      events.push("request finished");
      response.writeHead(200).end("slow");
    },
  });
  return { server, release, handlerEntered };
}

describe("Server", () => {
  describe("given an application request is still running when the server closes", () => {
    describe("when the request finishes", () => {
      /** @scenario "A request in flight at shutdown finishes before any hosted component stops" */
      it("finishes it before any component hears shutdown begin or stops", async () => {
        const events: string[] = [];
        const { server, release, handlerEntered } = await serverWithHeldRequest(events);
        const port = portOf(server);

        const slow = fetch(`http://127.0.0.1:${port}/slow`);
        await handlerEntered;
        const closing = server.close();
        await new Promise((resolve) => setTimeout(resolve, 50));
        release();
        const response = await slow;
        await closing;

        expect(response.status).toBe(200);
        expect(events).toEqual([
          "request finished",
          "stores stopping",
          "runtime stopped",
          "stores stopped",
        ]);
      });
    });

    describe("when a new product request arrives during the drain", () => {
      /** @scenario "A product request arriving while the application drains is refused by name" */
      it("answers it 503 while /healthz still answers 200", async () => {
        const events: string[] = [];
        const { server, release, handlerEntered } = await serverWithHeldRequest(events);
        const port = portOf(server);

        const slow = fetch(`http://127.0.0.1:${port}/slow`);
        await handlerEntered;
        const closing = server.close();
        const late = await fetch(`http://127.0.0.1:${port}/fast`);
        const probe = await fetch(`http://127.0.0.1:${port}/healthz`);
        release();
        await slow;
        await closing;

        expect(late.status).toBe(503);
        expect(late.headers.get("retry-after")).toBe("5");
        await expect(late.text()).resolves.toContain("shutting down");
        expect(probe.status).toBe(200);
      });
    });
  });

  describe("given a request's client disconnected while its handler still runs", () => {
    describe("when the server closes and the handler finishes afterwards", () => {
      /** @scenario "A request whose client went away still holds the drain until its handler finishes" */
      it("holds every component until the handler settles", async () => {
        const events: string[] = [];
        const { server, release, handlerEntered } = await serverWithHeldRequest(events);
        const port = portOf(server);
        const client = new AbortController();

        const slow = fetch(`http://127.0.0.1:${port}/slow`, { signal: client.signal });
        await handlerEntered;
        client.abort();
        await slow.catch(() => undefined);
        const closing = server.close();
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.push("released");
        release();
        await closing;

        expect(events).toEqual([
          "released",
          "request finished",
          "stores stopping",
          "runtime stopped",
          "stores stopped",
        ]);
      });
    });
  });

  describe("given a request outlives the drain grace", () => {
    describe("when the server cuts its response", () => {
      /** @scenario "A handler cut at the drain grace gets a short unwind before the stores close" */
      it("lets the handler unwind before any component stops", async () => {
        const events: string[] = [];
        const { server, handlerEntered } = await serverWithHeldRequest(events);
        const port = portOf(server);

        const cut = fetch(`http://127.0.0.1:${port}/unwinds`).catch(() => undefined);
        await handlerEntered;
        await server.close();
        await cut;

        expect(events).toEqual([
          "handler unwound",
          "stores stopping",
          "runtime stopped",
          "stores stopped",
        ]);
        expect(lines.findLine("info", "outlived the drain grace")).toBeDefined();
      }, 15_000);
    });
  });

  describe("given a client holds an event stream open when the server closes", () => {
    describe("when the application drains", () => {
      /** @scenario "An open event stream is closed at shutdown rather than waited on" */
      it("closes the stream and stops the components without waiting out the grace", async () => {
        const events: string[] = [];
        const { server, handlerEntered } = await serverWithHeldRequest(events);
        const port = portOf(server);

        const stream = await fetch(`http://127.0.0.1:${port}/stream`, {
          headers: { Accept: "text/event-stream" },
        });
        await handlerEntered;
        const startedAt = Date.now();
        await server.close();

        expect(Date.now() - startedAt).toBeLessThan(HTTP_DRAIN_GRACE_MS);
        expect(events).toEqual(["stores stopping", "runtime stopped", "stores stopped"]);
        expect(lines.findLine("info", "outlived the drain grace")).toBeUndefined();
        // The client sees its stream cut, so it reconnects to a pod still serving.
        await expect(stream.text()).rejects.toThrow(TypeError);
      });
    });
  });
});
