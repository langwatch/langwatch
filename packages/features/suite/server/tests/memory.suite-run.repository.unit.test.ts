import { createTenantId, type Projection } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { MemorySuiteRunRepository } from "../src/repositories/memory/memory.suite-run.repository";

const state: SuiteRunStateData = {
  SuiteRunId: "run_1",
  BatchRunId: "batch_1",
  ScenarioSetId: "set_1",
  SuiteId: "suite_1",
  Status: "IN_PROGRESS",
  Total: 1,
  StartedCount: 0,
  CompletedCount: 0,
  FailedCount: 0,
  Progress: 0,
  PassRateBps: null,
  CreatedAt: 1,
  UpdatedAt: 1,
  LastEventOccurredAt: 1,
  StartedAt: 1,
  FinishedAt: null,
  PassedCount: 0,
  GradedCount: 0,
};

describe("MemorySuiteRunRepository", () => {
  it("keeps Eventing projections while service reads remain intentionally empty", async () => {
    const repository = MemorySuiteRunRepository.create();
    const tenantId = createTenantId("project_1");
    const projection: Projection<SuiteRunStateData> = {
      id: "projection_1",
      aggregateId: "batch_1",
      tenantId,
      version: "2026-08-25",
      data: state,
    };

    await repository.storeProjection(projection, { tenantId });

    await expect(repository.getProjection("batch_1", { tenantId })).resolves.toEqual(projection);
    await expect(repository.getSuiteRunState({ projectId: "project_1", batchRunId: "batch_1" })).resolves.toBeNull();
    await expect(repository.getBatchHistory({ projectId: "project_1", scenarioSetId: "set_1" })).resolves.toEqual([]);
  });
});
