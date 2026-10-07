/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { type UpgradeGate, upgradeGateComponent } from "../upgrade-gate.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function component({ gate, role = "api" }: { gate: UpgradeGate; role?: "api" | "worker" }) {
  const { logger, lines } = createTestLogger();
  const hosted = upgradeGateComponent({
    server: "gate-log-test",
    role,
    gate,
    logger,
    pollEveryMs: 10,
  });
  return { hosted, lines };
}

describe("the upgrade gate's console lines", () => {
  describe("when an api starts and its gate admits it", () => {
    /** @scenario "A serving process logs that it checks the ledger, then that it serves, with how long the check took" */
    it("logs the check with what it waits on, then that it serves with the check's time", async () => {
      const { hosted, lines } = component({
        gate: { admit: async () => ({ admitted: true }), release: async () => undefined },
      });
      await hosted.start?.();
      const checking = lines.findLine("info", "checking the upgrade ledger");
      const serving = lines.findLine("info", "serving (checked in");
      expect(checking).toMatchObject({
        phase: "upgrade-gate",
        waitingOn: expect.stringContaining("upgrade ledger"),
      });
      expect(serving).toMatchObject({ phase: "upgrade-gate", elapsedMs: expect.any(Number) });
      await hosted.stop?.();
    });
  });

  describe("given the upgrade ledger cannot be read", () => {
    /** @scenario "A serving process that cannot read the ledger names DATABASE_URL" */
    it("refuses naming DATABASE_URL, with the next action and no password", async () => {
      const { hosted, lines } = component({
        gate: {
          admit: async () => {
            throw new Error("connect ECONNREFUSED postgresql://lw:hunter2@db:5432/lw");
          },
          release: async () => undefined,
        },
      });
      await expect(hosted.start?.()).rejects.toMatchObject({ code: "upgrade_gate_refused" });
      const refused = lines.findLine("error", "refuses to serve");
      expect(refused?.msg).toContain("DATABASE_URL");
      expect(refused).toMatchObject({ next: expect.stringContaining("DATABASE_URL") });
      expect(JSON.stringify(lines)).not.toContain("hunter2");
    });
  });

  describe("given an admitted worker whose roster entry lapses and is written again", () => {
    /** @scenario "A lapsed roster entry is logged with what to check, and the recovery says how long serving stopped" */
    it("says readiness answers 503 and what it waits on, then how long serving stopped", async () => {
      const state = { serving: true };
      const { hosted, lines } = component({
        role: "worker",
        gate: {
          admit: async () => ({ admitted: true }),
          release: async () => undefined,
          serving: () => state.serving,
        },
      });
      await hosted.start?.();
      state.serving = false;
      await wait(60);
      state.serving = true;
      await wait(60);
      await hosted.stop?.();
      const lapsed = lines.findLine("error", "stopped serving");
      expect(lapsed?.msg).toContain("readiness answers 503");
      expect(lapsed?.msg).toContain("the worker takes no new jobs (in-flight ones finish)");
      expect(lines.findLine("info", "serves again")?.msg).toContain(
        "the worker takes new jobs again",
      );
      expect(lapsed).toMatchObject({
        phase: "roster",
        waitingOn: expect.stringContaining("roster write"),
      });
      expect(lines.findLine("info", "serves again")).toMatchObject({
        stoppedForMs: expect.any(Number),
      });
    });
  });
});
