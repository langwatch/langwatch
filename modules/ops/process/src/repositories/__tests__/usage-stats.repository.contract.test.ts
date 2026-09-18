/**
 * @vitest-environment node
 * The usage-stats worker's repository boundaries, stated once and run over
 * the memory twins: the same organization list, project counts and
 * ClickHouse counts the Prisma and ClickHouse backends answer with.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../memory/memory.ops.store.ts";
import {
  MemoryUsageStatsClickHouseRepository,
  MemoryUsageStatsOrganizationRepository,
  MemoryUsageStatsProjectRepository,
} from "../memory/memory.usage-stats.repository.ts";
import type {
  UsageStatsClickHouseRepository,
  UsageStatsOrganizationRepository,
  UsageStatsProjectRepository,
} from "../observe/usage-stats.repository.ts";

interface Backend {
  organizations: () => UsageStatsOrganizationRepository;
  projects: () => UsageStatsProjectRepository;
  clickhouse: () => UsageStatsClickHouseRepository;
}

function contractCases(backend: Backend): void {
  describe("when organizations are listed for usage stats", () => {
    it("answers an empty list before any organization is stored", async () => {
      expect(await backend.organizations().listForUsageStats()).toEqual([]);
    });
  });

  describe("when project counts are collected", () => {
    it("answers zeroed counts for an organization with no stored counts", async () => {
      const counts = await backend
        .projects()
        .collectProjectCounts({ organizationId: "org_unknown", builderChartKind: "custom" });

      expect(counts).toMatchObject({ projectIds: [], annotations: 0, workflows: 0 });
    });
  });

  describe("when ClickHouse counts are read", () => {
    it("answers zero for an organization with no stored counts", async () => {
      const ch = backend.clickhouse();

      expect(
        await ch.findTraceCount({ organizationId: "org_unknown", projectIds: [] }),
      ).toBe(0);
      expect(
        await ch.findScenarioRunCount({ organizationId: "org_unknown", projectIds: [] }),
      ).toBe(0);
    });
  });
}

describe("given the memory usage-stats repositories", () => {
  let store: MemoryOpsStore;

  beforeEach(() => {
    store = MemoryOpsStore.create();
  });

  contractCases({
    organizations: () => MemoryUsageStatsOrganizationRepository.create({ store }),
    projects: () => MemoryUsageStatsProjectRepository.create({ store }),
    clickhouse: () => MemoryUsageStatsClickHouseRepository.create({ store }),
  });

  it("lists the organizations stored ahead of a report", async () => {
    store.usageStatsOrganizations.push({ id: "org_1", name: "Acme" });

    const listed = await MemoryUsageStatsOrganizationRepository.create({ store }).listForUsageStats();

    expect(listed).toEqual([{ id: "org_1", name: "Acme" }]);
  });

  it("returns the project counts stored for an organization", async () => {
    store.usageStatsProjectCounts.set("org_1", {
      projectIds: ["project_1"],
      annotations: 3,
      annotationQueues: 0,
      annotationQueueItems: 0,
      annotationScores: 0,
      batchEvaluations: 0,
      customGraphs: 0,
      datasets: 0,
      datasetRecords: 0,
      experiments: 0,
      triggers: 0,
      workflows: 0,
    });

    const counts = await MemoryUsageStatsProjectRepository.create({ store }).collectProjectCounts({
      organizationId: "org_1",
      builderChartKind: "custom",
    });

    expect(counts).toMatchObject({ projectIds: ["project_1"], annotations: 3 });
  });

  it("returns the ClickHouse counts stored for an organization", async () => {
    store.usageStatsClickHouseCounts.set("org_1", { traceCount: 12, scenarioRunCount: 4 });
    const repository = MemoryUsageStatsClickHouseRepository.create({ store });

    expect(
      await repository.findTraceCount({ organizationId: "org_1", projectIds: ["project_1"] }),
    ).toBe(12);
    expect(
      await repository.findScenarioRunCount({ organizationId: "org_1", projectIds: ["project_1"] }),
    ).toBe(4);
  });
});
