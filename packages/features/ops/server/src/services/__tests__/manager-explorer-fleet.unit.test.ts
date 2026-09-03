import type { ProcessStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { ManagerExplorerService } from "../manager-explorer.service";
import { NullProcessAuditSink } from "../../repositories/prisma/prisma.process-audit.repository";
import {
  NullProcessOpsRepository,
  type ProcessNameCounts,
} from "../../ports/process-ops.repository";
import {
  OpsEventingIntrospectionPort,
  type OpsProcessManagerMetadata,
} from "../../ports/eventing-introspection.port";

function fakeStore(): ProcessStore {
  return {
    findByRef: vi.fn(async () => null),
    hasConsumedSource: vi.fn(async () => false),
    findMessagesByRef: vi.fn(async () => []),
    commit: vi.fn(),
    requeueDeadMessages: vi.fn(async () => 0),
  } as unknown as ProcessStore;
}

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

function serviceWithCounts(rows: ProcessNameCounts[], registryNames: string[] = []) {
  const fleet = new NullProcessOpsRepository();
  fleet.countByProcessName = async () => rows;

  const registry: OpsProcessManagerMetadata[] = registryNames.map((processName) => ({
    processName,
    pipelineName: `${processName}.pipeline`,
    aggregateType: "aggregate",
    eventTypes: [],
    intentTypes: [],
    scheduled: false,
    everyMs: null,
    hasWake: true,
  }));

  class FakeIntrospection extends OpsEventingIntrospectionPort {
    projections(): never[] {
      return [];
    }

    processManagers(): OpsProcessManagerMetadata[] {
      return registry;
    }

    dejaViewProjections(): never[] {
      return [];
    }
  }

  return new ManagerExplorerService({
    store: fakeStore(),
    fleet,
    audit: new NullProcessAuditSink(),
    introspection: new FakeIntrospection(),
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
      const service = serviceWithCounts([counts("retired.process", { deadMessages: 2 })]);
      const rows = await service.getFleetSummary();
      const retired = rows.find((r) => r.processName === "retired.process");
      expect(retired?.pipelineName).toBe("(not registered)");
      expect(retired?.deadMessages).toBe(2);
    });
  });
});
