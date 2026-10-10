/**
 * @vitest-environment node
 * @see specs/upgrade-holding-page.feature
 */
import http from "node:http";

import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startHeartbeat,
  startLivenessThread,
  type Heartbeat,
  type LivenessThread,
} from "../../lifecycle/liveness-thread.ts";
import { type UpgradeGateVerdict, upgradeGateComponent } from "../upgrade-gate.ts";

const threads: LivenessThread[] = [];
const heartbeats: Heartbeat[] = [];
const listeners: http.Server[] = [];

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  for (const heartbeat of heartbeats.splice(0)) heartbeat.stop();
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

async function bootThread(): Promise<LivenessThread> {
  const listener = http.createServer((_req, res) => {
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
    logger: { info: vi.fn(), error: vi.fn() },
  });
  threads.push(thread);
  return thread;
}

describe("the upgrade gate of an api that upgrades", () => {
  describe("given an open liveness thread and a gate answering upgrading", () => {
    /** @scenario "An upgrading api serves every request at once" */
    it("starts at once and every request reaches the main thread while it is not ready", async () => {
      const thread = await bootThread();
      const hosted = upgradeGateComponent({
        server: "gate-serve-test",
        role: "api",
        gate: {
          admit: async () => ({
            admitted: false,
            outcome: "upgrading",
            outstanding: ["prisma:20261006180000_add_column", "clickhouse:00042"],
          }),
          release: async () => undefined,
        },
        logger: createTestLogger().logger,
        reAskMs: 60_000,
      });

      await hosted.start?.();
      const page = await fetch(`http://127.0.0.1:${thread.address.port}/settings`, {
        headers: { Accept: "text/html" },
      });
      const ingest = await fetch(`http://127.0.0.1:${thread.address.port}/api/otel/v1/traces`, {
        method: "POST",
        body: "spans",
      });

      expect([page.status, ingest.status]).toEqual([200, 200]);
      expect(await page.text()).toBe("main");
      await expect(hosted.ready?.()).rejects.toThrow(/upgrading/);
      await hosted.stop?.();
    });
  });

  describe("given an api whose gate answers upgrading until it admits", () => {
    /** @scenario "The api never runs the upgrade when its installation is behind" */
    it("serves at once, asks again until admitted, then is ready", async () => {
      const answers: UpgradeGateVerdict[] = [
        {
          admitted: false,
          outcome: "upgrading",
          outstanding: ["prisma:20261006180000_add_column"],
        },
        { admitted: false, outcome: "upgrading", outstanding: ["clickhouse:00042"] },
        { admitted: true },
      ];
      const admit = vi.fn(
        async (): Promise<UpgradeGateVerdict> => answers.shift() ?? { admitted: true },
      );
      const hosted = upgradeGateComponent({
        server: "gate-serve-test",
        role: "api",
        gate: { admit, release: async () => undefined },
        logger: createTestLogger().logger,
        reAskMs: 1,
      });

      await hosted.start?.();
      await vi.waitFor(() => expect(hosted.ready?.()).resolves.toBeUndefined());

      expect(admit).toHaveBeenCalledTimes(3);
      await hosted.stop?.();
    });
  });
});
