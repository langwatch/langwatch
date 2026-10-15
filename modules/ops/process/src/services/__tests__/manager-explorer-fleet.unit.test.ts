import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { HANDOFF_PROCESS_NAME, InMemoryProcessStore, type ProcessStore } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { OpsEventingIntrospection, OpsProcessManagerMetadata } from "../../app/ops.app.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryProcessOpsRepository } from "../../repositories/memory/memory.process-ops.repository.ts";
import type { ProcessNameCounts } from "../../repositories/process-ops.repository.ts";
import { ManagerExplorerService } from "../manager-explorer.service.ts";
import { ProcessAuditService } from "../process-audit.service.ts";

function fakeStore(): ProcessStore {
  return InMemoryProcessStore.createForTesting();
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
  const fleet = MemoryProcessOpsRepository.create({ store: MemoryOpsStore.create() });
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

  class FakeIntrospection implements OpsEventingIntrospection {
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

  return ManagerExplorerService.create({
    store: fakeStore(),
    fleet,
    audit: ProcessAuditService.create({
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    }),
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
    /** @scenario "The operator fleet is read from the process-manager tables" */
    it("still shows them, naming the registry gap", async () => {
      const service = serviceWithCounts([counts("retired.process", { deadMessages: 2 })]);
      const rows = await service.getFleetSummary();
      const retired = rows.find((r) => r.processName === "retired.process");
      expect(retired?.pipelineName).toBe("(not registered)");
      expect(retired?.deadMessages).toBe(2);
    });
  });

  describe("given dead messages under the eventing hand-off outbox", () => {
    /** @scenario "The eventing hand-off outbox is named, not shown as unregistered" */
    it("names the row as the hand-off outbox", async () => {
      const service = serviceWithCounts([counts(HANDOFF_PROCESS_NAME, { deadMessages: 7 })]);
      const rows = await service.getFleetSummary();
      const handoff = rows.find((r) => r.processName === HANDOFF_PROCESS_NAME);
      expect(handoff?.pipelineName).toBe("(eventing hand-off outbox)");
    });
  });
});
