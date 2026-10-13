import { createTenantId, type Projection } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { MemorySuiteRunRepository } from "../memory.suite-run.repository.ts";

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

function projectionOf(data: SuiteRunStateData, id = "projection_1"): Projection<SuiteRunStateData> {
  return {
    id,
    aggregateId: data.BatchRunId,
    tenantId: createTenantId("project_1"),
    version: "2026-08-25",
    data,
  };
}

describe("MemorySuiteRunRepository", () => {
  describe("given a projection was stored", () => {
    describe("when the run state is read back", () => {
      it("answers what was written rather than nothing", async () => {
        const repository = MemorySuiteRunRepository.create();
        const tenantId = createTenantId("project_1");
        const projection = projectionOf(state);

        await repository.storeProjection(projection, { tenantId });

        await expect(repository.findProjection("batch_1", { tenantId })).resolves.toEqual(
          projection,
        );
      });
    });

    describe("when another tenant reads the same batch", () => {
      it("finds nothing, because the twin is scoped the way the live store is", async () => {
        const repository = MemorySuiteRunRepository.create();

        await repository.storeProjection(projectionOf(state), {
          tenantId: createTenantId("project_1"),
        });

        await expect(
          repository.findProjection("batch_1", { tenantId: createTenantId("project_2") }),
        ).resolves.toBeNull();
      });
    });
  });
});
