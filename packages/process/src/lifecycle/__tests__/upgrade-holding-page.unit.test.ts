import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIVENESS_PATH,
  renderUpgradeHoldingPage,
  startHeartbeat,
  startLivenessThread,
  type Heartbeat,
  type LivenessThread,
} from "../liveness-thread.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const threads: LivenessThread[] = [];
const heartbeats: Heartbeat[] = [];
const listeners: http.Server[] = [];
const holding = { phase: "schema", outstandingStepIds: ["clickhouse:00042", "trace:fill-cost"] };

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

describe("the upgrade holding page", () => {
  describe("given the liveness thread is holding for an upgrade", () => {
    describe("when a browser asks for a page", () => {
      /** @scenario "A browser sees the holding page while an upgrade holds the door" */
      it("answers 503 with the phase and step ids, a retry header and no caching", async () => {
        const thread = await bootThread({ onProxied: () => {} });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        const body = await response.text();

        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("retry-after")).toBe("10");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toContain("LangWatch is upgrading");
        expect(body).toContain("schema");
        expect(body).toContain("clickhouse:00042");
        expect(body).toContain("trace:fill-cost");
      });
    });

    describe("when a JSON client calls an API path", () => {
      /** @scenario "An API caller keeps a plain 503 with a retry header while an upgrade holds the door" */
      it("answers a plain 503 and never reaches the main thread", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, "/api/traces"), {
          headers: { Accept: "application/json" },
        });

        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toBe("text/plain");
        expect(response.headers.get("retry-after")).toBe("10");
        expect(await response.text()).not.toContain("clickhouse:00042");
        expect(onProxied).not.toHaveBeenCalled();
      });
    });

    describe("when the kubelet probes liveness", () => {
      /** @scenario "Liveness still answers while an upgrade holds the door" */
      it("answers 200", async () => {
        const thread = await bootThread({ onProxied: () => {} });
        await thread.hold(holding);

        const response = await fetch(urlOf(thread.address, LIVENESS_PATH));

        expect(response.status).toBe(200);
      });
    });

    describe("when the hold is lifted", () => {
      /** @scenario "Lifting the hold sends requests to the main thread again" */
      it("proxies to the main thread again", async () => {
        const onProxied = vi.fn();
        const thread = await bootThread({ onProxied });
        await thread.hold(holding);
        await thread.hold(undefined);

        const response = await fetch(urlOf(thread.address, "/settings"), {
          headers: { Accept: "text/html" },
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("main");
        expect(onProxied).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given a phase and step ids carrying markup", () => {
    /** @scenario "The holding page escapes everything it renders" */
    it("renders them escaped", () => {
      const page = renderUpgradeHoldingPage({
        phase: "<script>alert(1)</script>",
        outstandingStepIds: [`x:"><img src=x onerror=alert(1)>`],
      });

      expect(page).not.toContain("<script>");
      expect(page).not.toContain("<img");
      expect(page).toContain("&#60;script&#62;");
    });
  });
});
