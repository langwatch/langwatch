import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Server, type DoorHandler, type ServedApplication } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };

const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
  logger.info.mockClear();
  logger.error.mockClear();
});

function createServer(): Server {
  const server = Server.create({ name: "test-server", logger, ownsProcess: false });
  activeServers.push(server);

  return server;
}

function fetchFrom(server: Server, path: string): Promise<Response> {
  const address = server.healthAddress;
  if (address === null || typeof address === "string") {
    throw new Error("health door did not bind an IP port");
  }

  return fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`);
}

/** A handler that answers the paths it was given and declines everything else. */
function handlerFor(options: {
  name: string;
  order?: number;
  paths: readonly string[];
  body: string;
}): DoorHandler {
  return {
    name: options.name,
    ...(options.order === undefined ? {} : { order: options.order }),
    handle: (request, response) => {
      if (!options.paths.includes(request.url ?? "")) return false;
      response.writeHead(200, { "Content-Type": "text/plain" }).end(options.body);

      return true;
    },
  };
}

/** A booted application, as the server reads one: lifecycle plus transports. */
function applicationOf(transports: {
  rest: readonly unknown[];
  trpc: Record<string, unknown>;
}): ServedApplication {
  return {
    name: "test application",
    start: () => void 0,
    stop: () => void 0,
    transports,
  };
}

describe("Server door", () => {
  describe("given two handlers contributed with different orders", () => {
    describe("when a request only the later one answers arrives", () => {
      /** @scenario "A declining contribution falls through to the next" */
      it("tries them in order and serves the one that claims it", async () => {
        const server = createServer();
        server.with(handlerFor({ name: "late", order: 500, paths: ["/x"], body: "late" }));
        server.with(handlerFor({ name: "early", order: 10, paths: ["/y"], body: "early" }));

        await server.listen();

        await expect(fetchFrom(server, "/x").then((r) => r.text())).resolves.toBe("late");
        await expect(fetchFrom(server, "/y").then((r) => r.text())).resolves.toBe("early");
      });
    });

    describe("when both would answer the same request", () => {
      /** @scenario "The lower order answers first" */
      it("serves the lower order and never asks the other", async () => {
        const server = createServer();
        server.with(handlerFor({ name: "late", order: 500, paths: ["/x"], body: "late" }));
        server.with(handlerFor({ name: "early", order: 10, paths: ["/x"], body: "early" }));

        await server.listen();

        await expect(fetchFrom(server, "/x").then((r) => r.text())).resolves.toBe("early");
      });
    });
  });

  describe("given every contribution declines the request", () => {
    describe("when it arrives", () => {
      /** @scenario "Nothing on the door claims the request" */
      it("answers 404", async () => {
        const server = createServer();
        server.with(handlerFor({ name: "one", paths: ["/x"], body: "one" }));

        await server.listen();

        await expect(fetchFrom(server, "/nowhere").then((r) => r.status)).resolves.toBe(404);
      });
    });
  });

  describe("given a contribution that throws", () => {
    describe("when it is asked", () => {
      /** @scenario "A door handler fails" */
      it("answers 500 and reports the handler by name", async () => {
        const server = createServer();
        server.with({
          name: "broken",
          handle: () => {
            throw new Error("handler exploded");
          },
        });

        await server.listen();

        await expect(fetchFrom(server, "/x").then((r) => r.status)).resolves.toBe(500);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ handler: "broken" }),
          expect.stringContaining("door handler failed"),
        );
      });
    });
  });

  describe("given an application whose transports all mounted on one door", () => {
    describe("when the server serves it", () => {
      /** @scenario "One door carries every mounted transport" */
      it("hosts that door once, however many transports name it", async () => {
        const server = createServer();
        const asked = vi.fn(() => false);
        const door: DoorHandler = { name: "api", handle: asked };

        await server.serve(applicationOf({ rest: [door, door], trpc: { a: door, b: door } }));
        await fetchFrom(server, "/x");

        expect(asked).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a transport is not something the server can serve", () => {
      /** @scenario "A mounted transport is not a door handler" */
      it("refuses to serve, naming the application", () => {
        const server = createServer();

        expect(() => server.serve(applicationOf({ rest: [{ mounted: true }], trpc: {} }))).toThrow(
          /test application/,
        );
      });
    });
  });

  describe("given a serving process that has begun shutting down", () => {
    describe("when a request arrives", () => {
      /** @scenario "The door refuses new work while draining" */
      it("refuses it with 503 while /healthz still answers", async () => {
        const server = createServer();
        // Held open on a component's teardown, because the health door stops
        // last: this is the window a draining pod is actually observed in.
        let release = (): void => void 0;
        const draining = new Promise<void>((resolve) => {
          release = resolve;
        });
        server.with({ name: "slow", stop: () => draining });
        server.with(handlerFor({ name: "api", paths: ["/x"], body: "api" }));
        await server.listen();

        const closing = server.close();

        await expect(fetchFrom(server, "/x").then((r) => r.status)).resolves.toBe(503);
        await expect(fetchFrom(server, "/healthz").then((r) => r.status)).resolves.toBe(200);
        release();
        await closing;
      });
    });
  });
});
