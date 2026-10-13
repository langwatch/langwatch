/**
 * @vitest-environment node
 * @see packages/process/specs/upgrade-holding-page.feature
 */
import { createHash } from "node:crypto";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startHeartbeat,
  startLivenessThread,
  type Heartbeat,
  type LivenessThread,
  type UpgradeConsole,
} from "../liveness-thread.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const threads: LivenessThread[] = [];
const heartbeats: Heartbeat[] = [];
const listeners: http.Server[] = [];
const failedConsole: UpgradeConsole = {
  passThrough: ["/api/health"],
  failedSteps: [{ id: "prisma:20261009_add_column", error: "column exists" }],
  logTail: ["[upgrade] failed"],
  tokenSha256: createHash("sha256").update("token").digest("hex"),
  tokenTtlMs: 60_000,
};

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  for (const heartbeat of heartbeats.splice(0)) heartbeat.stop();
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

async function bootThread({ onProxied }: { onProxied: () => void }): Promise<LivenessThread> {
  const listener = http.createServer((_req, res) => {
    onProxied();
    res.writeHead(200, { "Content-Type": "text/plain" }).end("main");
  });
  listener.on("upgrade", (_req, socket) => {
    onProxied();
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n");
  });
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  const heartbeat = startHeartbeat({ intervalMs: 5 });
  heartbeats.push(heartbeat);
  const thread = await startLivenessThread({
    port: 0,
    heartbeat: heartbeat.buffer,
    proxyPort: address.port,
    logger,
  });
  threads.push(thread);
  return thread;
}

const urlOf = ({ port }: AddressInfo, path: string): string => `http://127.0.0.1:${port}${path}`;

function askWebSocket(thread: LivenessThread): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: thread.address.port }, () =>
      socket.write(
        "GET /api/stream HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n" +
          "Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      ),
    );
    let received = "";
    socket.on("data", (chunk) => (received += chunk.toString()));
    socket.on("close", () => resolve(received));
    socket.on("error", reject);
  });
}

describe("the liveness door while an upgrade runs", () => {
  describe("given the liveness thread shows no console", () => {
    describe("when a client asks to upgrade to a WebSocket", () => {
      /** @scenario "A WebSocket upgrade reaches the main thread while the installation upgrades" */
      it("proxies the connection to the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });

        const reply = await askWebSocket(thread);

        expect(reply.startsWith("HTTP/1.1 101")).toBe(true);
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the liveness thread shows a failed first install's console", () => {
    describe("when a JSON client calls an API path", () => {
      /** @scenario "An API caller keeps a plain 503 with a retry header while the console shows" */
      it("answers a plain 503 and never reaches the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        void thread.holdConsole(failedConsole);

        await vi.waitFor(async () =>
          expect((await fetch(urlOf(thread.address, "/api/traces"))).status).toBe(503),
        );
        const response = await fetch(urlOf(thread.address, "/api/traces"), {
          headers: { Accept: "application/json" },
        });

        expect(response.headers.get("content-type")).toBe("text/plain");
        expect(response.headers.get("retry-after")).toBe("10");
        expect(await response.text()).not.toContain("prisma:20261009_add_column");
        expect(onProxied).not.toHaveBeenCalled();
      });
    });

    describe("when a client asks to upgrade to a WebSocket", () => {
      /** @scenario "A WebSocket upgrade is refused while the console shows" */
      it("answers 503 with a retry header and never reaches the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        void thread.holdConsole(failedConsole);
        await vi.waitFor(async () =>
          expect((await fetch(urlOf(thread.address, "/settings"))).status).toBe(503),
        );

        const reply = await askWebSocket(thread);

        expect(reply.startsWith("HTTP/1.1 503")).toBe(true);
        expect(reply).toContain("Retry-After: 10");
        expect(onProxied).not.toHaveBeenCalled();
      });
    });

    describe("when the kubelet requests the api's health route", () => {
      /** @scenario "A health route reaches the main thread while the console shows" */
      it("proxies it to the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        void thread.holdConsole(failedConsole);
        await vi.waitFor(async () =>
          expect((await fetch(urlOf(thread.address, "/settings"))).status).toBe(503),
        );

        const response = await fetch(urlOf(thread.address, "/api/health?probe=1"));

        expect(response.status).toBe(200);
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });

    describe("when the console is lifted", () => {
      /** @scenario "Lifting the console sends requests to the main thread again" */
      it("proxies to the main thread again", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        void thread.holdConsole(failedConsole);
        await vi.waitFor(async () =>
          expect((await fetch(urlOf(thread.address, "/settings"))).status).toBe(503),
        );
        await thread.liftConsole();

        const response = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html" },
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("main");
      });
    });
  });
});
