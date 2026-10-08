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

describe("the upgrade gate and the holding page", () => {
  describe("given an open liveness thread and a gate that has not answered", () => {
    /** @scenario "A waiting upgrade gate holds the door until it admits the process" */
    it("serves the holding page while it waits and proxies once it admits", async () => {
      const thread = await bootThread();
      let admit: (verdict: UpgradeGateVerdict) => void = () => {};
      const answered = new Promise<UpgradeGateVerdict>((resolve) => (admit = resolve));
      const hosted = upgradeGateComponent({
        server: "gate-hold-test",
        role: "api",
        gate: { admit: () => answered, release: async () => undefined },
        logger: createTestLogger().logger,
        onHolding: (holding) => thread.hold(holding),
      });
      const browse = () =>
        fetch(`http://127.0.0.1:${thread.address.port}/settings`, {
          headers: { Accept: "text/html" },
        });

      const starting = hosted.start?.();
      await vi.waitFor(async () => expect((await browse()).status).toBe(503));
      expect(await (await browse()).text()).toContain("<strong>upgrade-gate</strong>");

      admit({ admitted: true });
      await starting;
      const served = await browse();

      expect(served.status).toBe(200);
      expect(await served.text()).toBe("main");
      await hosted.stop?.();
    });
  });

  describe("given a gate that refuses", () => {
    it("lifts the hold before it throws", async () => {
      const onHolding = vi.fn(async () => undefined);
      const hosted = upgradeGateComponent({
        server: "gate-hold-test",
        role: "api",
        gate: {
          admit: async () => ({ admitted: false, refusal: "behind" }),
          release: async () => undefined,
        },
        logger: createTestLogger().logger,
        onHolding,
      });

      await expect(hosted.start?.()).rejects.toThrow("refuses to serve");

      expect(onHolding.mock.calls).toEqual([
        [{ phase: "upgrade-gate", outstandingStepIds: [] }],
        [undefined],
      ]);
    });
  });
});
