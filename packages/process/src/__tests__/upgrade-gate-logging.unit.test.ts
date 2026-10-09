/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { type UpgradeGate, upgradeGateComponent } from "../migration/upgrade-gate.ts";

function component({ gate, role = "api" }: { gate: UpgradeGate; role?: "api" | "worker" }) {
  const { logger, lines } = createTestLogger();
  const hosted = upgradeGateComponent({
    server: "gate-log-test",
    role,
    gate,
    logger,
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
});
