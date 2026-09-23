import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bindHttpServer, Server, type HealthRoute } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };

const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
  logger.info.mockClear();
  logger.error.mockClear();
});

async function startServer(options: { healthPort?: number } = {}) {
  const server = Server.create({
    name: "test-server",
    logger,
    ownsProcess: false,
    ...options,
  });
  activeServers.push(server);
  return server;
}

function addressOf(server: Server): AddressInfo {
  const address = server.healthAddress;
  if (address === null || typeof address === "string") {
    throw new Error("health door did not bind an IP port");
  }
  return address;
}

function fetchFrom(server: Server, path: string, authorization?: string): Promise<Response> {
  const address = addressOf(server);
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("Server", () => {
  describe("given a server with no health port configured", () => {
    describe("when it starts", () => {
      /** @scenario "No health port is configured" */
      it("answers /healthz on an ephemeral port without any component being hosted", async () => {
        const server = await startServer();

        await server.listen();
        const response = await fetchFrom(server, "/healthz");

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("ok");
      });
    });
  });

  describe("given a server with a configured health port", () => {
    describe("when it starts", () => {
      /** @scenario "A health port is configured" */
      it("binds the health door there", async () => {
        const server = await startServer({ healthPort: 0 });

        await server.listen();

        expect(addressOf(server).port).toBeGreaterThan(0);
      });
    });
  });

  describe("given a component contributes a health-door route via .with()", () => {
    describe("when the route is scraped", () => {
      /** @scenario "A route is mounted alongside the built-in door" */
      it("serves it on the same listener as /healthz", async () => {
        const server = await startServer();
        const route: HealthRoute = {
          path: "/metrics",
          handle: (_request, response) => {
            response.writeHead(200, { "Content-Type": "text/plain" }).end("metric 1\n");
          },
        };

        server.with(route);
        await server.listen();
        const response = await fetchFrom(server, "/metrics");

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("metric 1\n");
      });
    });
  });

  describe("given an unregistered path", () => {
    describe("when it is requested", () => {
      /** @scenario "An unrelated path is requested" */
      it("answers 404", async () => {
        const server = await startServer();

        await server.listen();
        const response = await fetchFrom(server, "/not-a-real-path");

        expect(response.status).toBe(404);
      });
    });
  });

  describe("given a hosted component with a drain phase", () => {
    describe("when the server closes", () => {
      /** @scenario "A component drains while the health door stays reachable" */
      it("keeps the health door reachable while the drain is still running", async () => {
        const server = await startServer();
        let releaseDrain: () => void = () => undefined;
        const drainStarted = new Promise<void>((resolve) => {
          releaseDrain = resolve;
        });
        server.with({ name: "slow drain", stop: () => drainStarted, drain: true });
        await server.listen();

        void server.close();
        const duringDrain = await fetchFrom(server, "/healthz");

        expect(duringDrain.status).toBe(200);
        releaseDrain();
      });

      /** @scenario "The door closes once every component has stopped" */
      it("refuses connections once the drain has finished and the server has closed", async () => {
        const server = await startServer();
        server.with({ name: "quick component", stop: () => undefined });
        await server.listen();
        const address = addressOf(server);

        await server.close();

        await expect(fetch(`http://127.0.0.1:${address.port}/healthz`)).rejects.toThrow(TypeError);
      });
    });
  });

  describe("given the fluent chain", () => {
    describe("when a component is mounted with .with()", () => {
      /** @scenario ".with() returns the server so calls chain" */
      it("returns the same server, so calls chain", async () => {
        const server = await startServer();

        const chained = server.with({ name: "noop", stop: () => undefined });

        expect(chained).toBe(server);
      });
    });
  });
});

describe("binding a port a predecessor still holds", () => {
  describe("given the previous owner releases it shortly after", () => {
    /** @scenario "A listener waits for its predecessor to let go of the port" */
    it("binds as soon as it is free rather than failing at once", async () => {
      const predecessor = http.createServer();
      await new Promise<void>((resolve) => predecessor.listen(0, resolve));
      const port = (predecessor.address() as AddressInfo).port;
      setTimeout(() => predecessor.close(), 400);

      const successor = http.createServer();
      await bindHttpServer(successor, port, 5_000);

      expect((successor.address() as AddressInfo).port).toBe(port);
      successor.close();
    });
  });

  describe("given something that never releases it", () => {
    /** @scenario "A port another program owns is still a boot failure" */
    it("gives up once the handover window has passed, naming the address", async () => {
      const squatter = http.createServer();
      await new Promise<void>((resolve) => squatter.listen(0, resolve));
      const port = (squatter.address() as AddressInfo).port;

      // The errno, not the prose: the message is Node's to word.
      await expect(bindHttpServer(http.createServer(), port, 300)).rejects.toMatchObject({
        code: "EADDRINUSE",
      });

      squatter.close();
    });
  });
});
