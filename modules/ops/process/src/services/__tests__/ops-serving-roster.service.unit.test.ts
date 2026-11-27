/**
 * The serving processes ops hands a staff investigation: role, image and release, never the
 * process id. Spec: modules/ops/specs/upgrades.feature
 */
import type { ServingRosterEntry } from "@langwatch/upgrade";
import { describe, expect, it } from "vitest";

import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import { OpsUpgradeService } from "../ops-upgrade.service.ts";

const entry = (overrides: Partial<ServingRosterEntry>): ServingRosterEntry => ({
  processId: "process_secret_host_1",
  role: "api",
  image: "langwatch/langwatch:v3.24.0",
  release: "3.24.0",
  steps: [],
  startedAt: new Date("2026-11-26T08:00:00Z"),
  heartbeatAt: new Date("2026-11-26T10:00:00Z"),
  ...overrides,
});

describe("OpsUpgradeService.findServingProcesses", () => {
  describe("given a roster with a live api and worker", () => {
    /** @scenario "The serving processes are read by role, image and release only" */
    it("answers role, image, release and times, oldest first, with no process id", async () => {
      const ledger = Object.assign(MemoryUpgradeLedgerRepository.create(), {
        findLiveRoster: async () => [
          entry({ role: "worker", startedAt: new Date("2026-11-26T09:00:00Z") }),
          entry({}),
        ],
      });
      const service = OpsUpgradeService.create({ ledger, isSaas: true });

      const processes = await service.findServingProcesses();

      expect(processes).toEqual([
        {
          role: "api",
          image: "langwatch/langwatch:v3.24.0",
          release: "3.24.0",
          startedAt: Date.parse("2026-11-26T08:00:00Z"),
          lastSeenAt: Date.parse("2026-11-26T10:00:00Z"),
        },
        {
          role: "worker",
          image: "langwatch/langwatch:v3.24.0",
          release: "3.24.0",
          startedAt: Date.parse("2026-11-26T09:00:00Z"),
          lastSeenAt: Date.parse("2026-11-26T10:00:00Z"),
        },
      ]);
      expect(JSON.stringify(processes)).not.toContain("process_secret_host_1");
    });
  });
});
