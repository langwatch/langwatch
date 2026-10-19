import type http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
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
        await expect(late.text()).resolves.toContain("shutting down");
        expect(probe.status).toBe(200);
      });
    });
  });
});
