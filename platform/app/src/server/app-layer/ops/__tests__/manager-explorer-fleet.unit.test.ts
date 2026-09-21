import { describe, expect, it } from "vitest";
import { InMemoryProcessStore } from "~/server/event-sourcing/process-manager/stores/inMemoryProcessStore";
import { ManagerExplorerService } from "../manager-explorer.service";
import { NullProcessAuditSink } from "../process-audit.repository";
import {
  NullProcessOpsRepository,
  type ProcessNameCounts,
} from "../repositories/process-ops.repository";

function counts(
  processName: string,
  overrides: Partial<ProcessNameCounts> = {},
): ProcessNameCounts {
  return {
    processName,
    instances: 0,
    overdueWakes: 0,
    pendingMessages: 0,
    overduePending: 0,
    lapsedLeases: 0,
    deadMessages: 0,
    ...overrides,
  };
}

function serviceWithCounts(
  rows: ProcessNameCounts[],
  registryNames: string[] = [],
) {
  const fleet = new NullProcessOpsRepository();
  fleet.countByProcessName = async () => rows;
  return new ManagerExplorerService({
    store: new InMemoryProcessStore(),
    fleet,
    audit: new NullProcessAuditSink(),
    registry: () =>
      registryNames.map((processName) => ({
        processName,
        pipelineName: `${processName}.pipeline`,
        aggregateType: "aggregate",
        eventTypes: [],
        intentTypes: [],
        scheduled: false,
        everyMs: null,
        hasWake: true,
      })),
  });
}

describe("ManagerExplorerService fleet summary", () => {
  describe("given processes with pending, lapsed, and dead outbox messages", () => {
    /** @scenario "Each process name reports its trouble counts on one row" */
    it("carries every trouble count per name and sorts trouble first", async () => {
      const service = serviceWithCounts(
        [
          counts("healthy", { instances: 1200, pendingMessages: 3 }),
          counts("troubled", {
            instances: 310,
            overdueWakes: 2,
            pendingMessages: 41,
            overduePending: 4,
            lapsedLeases: 1,
            deadMessages: 7,
          }),
        ],
        ["healthy", "troubled", "registeredButEmpty"],
      );

      const rows = await service.getFleetSummary();
      const names = rows.map((r) => r.processName);
      expect(names.indexOf("troubled")).toBeLessThan(names.indexOf("healthy"));

      const troubled = rows.find((r) => r.processName === "troubled");
      expect(troubled).toMatchObject({
        instances: 310,
        overdueWakes: 2,
        pendingMessages: 41,
        overduePending: 4,
        lapsedLeases: 1,
        deadMessages: 7,
      });

      // Registered but rowless still appears: a missing row and a healthy
      // row must not look identical.
      const empty = rows.find((r) => r.processName === "registeredButEmpty");
      expect(empty).toMatchObject({ instances: 0, deadMessages: 0 });
    });
  });

  describe("given rows the pipeline registry does not know", () => {
    it("still shows them, naming the registry gap", async () => {
      const service = serviceWithCounts([
        counts("retired.process", { deadMessages: 2 }),
      ]);
      const rows = await service.getFleetSummary();
      const retired = rows.find((r) => r.processName === "retired.process");
      expect(retired?.pipelineName).toBe("(not registered)");
      expect(retired?.deadMessages).toBe(2);
    });
  });
});
