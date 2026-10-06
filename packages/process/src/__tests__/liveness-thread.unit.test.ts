import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEARTBEAT_STALL_BUDGET_MS,
  LIVENESS_PATH,
  startHeartbeat,
  startLivenessThread,
  type LivenessThread,
} from "../liveness-thread.ts";
import { Server, type HealthRoute } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const threads: LivenessThread[] = [];
const listeners: http.Server[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const listener of listeners.splice(0)) listener.closeAllConnections();
  await Promise.all(
    listeners.map((listener) => new Promise<void>((resolve) => listener.close(() => resolve()))),
  );
});

/** A heartbeat nothing bumps, so the thread sees it age from the moment it starts. */
const stillHeartbeat = (): SharedArrayBuffer =>
  new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer;

/** The main thread's side of the proxy, on loopback. */
async function mainThreadListener(handler: http.RequestListener): Promise<number> {
  const listener = http.createServer(handler);
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  return (listener.address() as AddressInfo).port;
}

async function bootThread({
  stallBudgetMs = HEARTBEAT_STALL_BUDGET_MS,
  heartbeat = stillHeartbeat(),
  proxyPort,
}: {
  stallBudgetMs?: number;
  heartbeat?: SharedArrayBuffer;
  proxyPort: number;
}): Promise<LivenessThread> {
  const thread = await startLivenessThread({
    port: 0,
    heartbeat,
    stallBudgetMs,
    proxyPort,
    logger,
    proxyTimeoutMs: 300,
  });
  threads.push(thread);
  return thread;
}

const urlOf = (address: AddressInfo | string | null, path: string): string => {
  if (address === null || typeof address === "string") throw new Error("door bound no IP port");
  return `http://127.0.0.1:${address.port}${path}`;
};

describe("the liveness thread", () => {
  describe("given the main loop's heartbeat is fresher than the stall budget", () => {
    describe("when the kubelet requests the liveness path", () => {
      /** @scenario A busy-but-alive main loop still passes liveness */
      it("answers 200 long after the thread started", async () => {
        const heartbeat = startHeartbeat({ intervalMs: 5 });
        const thread = await bootThread({
          stallBudgetMs: 50,
          heartbeat: heartbeat.buffer,
          proxyPort: await mainThreadListener(() => {}),
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        heartbeat.stop();

        const response = await fetch(urlOf(thread.address, LIVENESS_PATH));

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("ok");
      });
    });
  });

  describe("given the main loop's heartbeat is older than the stall budget", () => {
    describe("when the kubelet requests the liveness path", () => {
      /** @scenario A main loop stalled past the budget fails liveness */
      it("answers 503 so a wedged process is restarted", async () => {
        const thread = await bootThread({
          stallBudgetMs: 20,
          proxyPort: await mainThreadListener(() => {}),
        });
        await new Promise((resolve) => setTimeout(resolve, 60));

        const response = await fetch(urlOf(thread.address, LIVENESS_PATH));

        expect(response.status).toBe(503);
        await expect(response.text()).resolves.toContain("stalled");
      });
    });
  });

  describe("given the main thread never answers the proxy", () => {
    describe("when a caller requests /metrics", () => {
      /** @scenario A metrics request fails when the main thread never replies */
      it("answers 503 once the proxy times out", async () => {
        const thread = await bootThread({
          proxyPort: await mainThreadListener(() => {}),
        });

        const response = await fetch(urlOf(thread.address, "/metrics"));

        expect(response.status).toBe(503);
      });
    });
  });
});

describe("Server", () => {
  describe("given a process with no HTTP surface whose door carries /metrics", () => {
    describe("when a caller requests /metrics and the main thread replies", () => {
      /** @scenario Metrics proxy through to the main thread */
      it("serves the main thread's status and body through the liveness thread", async () => {
        const server = Server.create({ name: "worker-test", logger, ownsProcess: false });
        servers.push(server);
        const metrics: HealthRoute = {
          path: "/metrics",
          handle: (request, response) => {
            const caller = request.headers.authorization ?? "nobody";
            response.writeHead(401, { "Content-Type": "text/plain" }).end(`refused ${caller}`);
          },
        };
        server.with(metrics);

        await server.run({ name: "worker", start: () => undefined, stop: () => undefined });
        const response = await fetch(urlOf(server.healthAddress, "/metrics"), {
          headers: { authorization: "Bearer wrong" },
        });
        const health = await fetch(urlOf(server.healthAddress, LIVENESS_PATH));

        expect(response.status).toBe(401);
        await expect(response.text()).resolves.toBe("refused Bearer wrong");
        expect(health.status).toBe(200);
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("liveness thread failed"),
        );
      });
    });
  });

  describe("given a process whose application takes minutes to start, as a voice tunnel can", () => {
    describe("when the kubelet probes while that start is still running", () => {
      /** @scenario The liveness server boots before every other stage, including the voice tunnel */
      it("answers liveness, because the health door is the first stage started", async () => {
        const server = Server.create({ name: "worker-test", logger, ownsProcess: false });
        servers.push(server);
        let releaseStart: () => void = () => undefined;
        const tunnel = new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        let started = false;

        const running = server.run({
          name: "worker",
          start: () => tunnel.then(() => void (started = true)),
          stop: () => undefined,
        });
        const address = await vi.waitFor(() => {
          if (server.healthAddress === null) throw new Error("the health door is not up yet");
          return server.healthAddress;
        });
        const health = await fetch(urlOf(address, LIVENESS_PATH));

        expect(health.status).toBe(200);
        expect(started).toBe(false);
        releaseStart();
        await running;
        expect(started).toBe(true);
      });
    });
  });

  describe("given a process with no HTTP surface and an upgrade router", () => {
    describe("when a caller upgrades", () => {
      it("hands the upgrade to the main thread's router through the thread", async () => {
        const server = Server.create({ name: "worker-test", logger, ownsProcess: false });
        servers.push(server);
        const upgraded = vi.fn((_request: http.IncomingMessage, socket: Duplex) => {
          socket.end(
            "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n",
          );
        });
        server.with({ upgrade: upgraded, close: async () => {} });
        await server.run({ name: "worker", start: () => undefined, stop: () => undefined });
        const { port } = server.healthAddress as AddressInfo;

        const status = await new Promise<number | undefined>((resolve, reject) => {
          const request = http.request({
            port,
            path: "/socket",
            headers: { Connection: "Upgrade", Upgrade: "test" },
          });
          request.once("upgrade", (response, socket) => {
            socket.destroy();
            resolve(response.statusCode);
          });
          request.once("error", reject);
          request.end();
        });

        expect(status).toBe(101);
        expect(upgraded.mock.calls[0]?.[0].url).toBe("/socket");
      });
    });
  });

  describe("given a process with no HTTP surface", () => {
    describe("when it closes", () => {
      it("releases the public port", async () => {
        const server = Server.create({ name: "worker-test", logger, ownsProcess: false });
        await server.run({ name: "worker", start: () => undefined, stop: () => undefined });
        const url = urlOf(server.healthAddress, LIVENESS_PATH);

        await server.close();

        await expect(fetch(url)).rejects.toThrow(TypeError);
      });
    });
  });
});
