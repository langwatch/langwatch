import { createTenantId, type Projection } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
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

function projectionOf(
  data: SuiteRunStateData,
  id = "projection_1",
): Projection<SuiteRunStateData> {
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

        await expect(repository.tryGetProjection("batch_1", { tenantId })).resolves.toEqual(
          projection,
        );
        await expect(
          repository.tryGetSuiteRunState({ projectId: "project_1", batchRunId: "batch_1" }),
        ).resolves.toEqual(state);
        await expect(
          repository.getBatchHistory({ projectId: "project_1", scenarioSetId: "set_1" }),
        ).resolves.toEqual([state]);
      });
    });

    describe("when another tenant reads the same batch", () => {
      it("finds nothing, because the twin is scoped the way the live store is", async () => {
        const repository = MemorySuiteRunRepository.create();

        await repository.storeProjection(projectionOf(state), {
          tenantId: createTenantId("project_1"),
        });

        await expect(
          repository.tryGetSuiteRunState({ projectId: "project_2", batchRunId: "batch_1" }),
        ).resolves.toBeNull();
        await expect(
          repository.getBatchHistory({ projectId: "project_2", scenarioSetId: "set_1" }),
        ).resolves.toEqual([]);
      });
    });
  });

  describe("given runs of one set were stored out of order", () => {
    describe("when the batch history is read", () => {
      it("answers newest first, up to the limit asked for", async () => {
        const repository = MemorySuiteRunRepository.create();
        const tenantId = createTenantId("project_1");
        const older = { ...state, BatchRunId: "batch_0", CreatedAt: 0 };
        const newer = { ...state, BatchRunId: "batch_2", CreatedAt: 5 };

        await repository.storeProjectionBatch(
          [projectionOf(newer, "projection_2"), projectionOf(older, "projection_0")],
          { tenantId },
        );

        await expect(
          repository.getBatchHistory({ projectId: "project_1", scenarioSetId: "set_1" }),
        ).resolves.toEqual([newer, older]);
        await expect(
          repository.getBatchHistory({
            projectId: "project_1",
            scenarioSetId: "set_1",
            limit: 1,
          }),
        ).resolves.toEqual([newer]);
      });
    });
  });

  describe("given a run recorded before scenario sets were named", () => {
    describe("when the default set's history is read", () => {
      it("finds it, the way the live store's IN filter does", async () => {
        const repository = MemorySuiteRunRepository.create();
        const unnamed = { ...state, ScenarioSetId: "" };

        await repository.storeProjection(projectionOf(unnamed), {
          tenantId: createTenantId("project_1"),
        });

        await expect(
          repository.getBatchHistory({ projectId: "project_1", scenarioSetId: "default" }),
        ).resolves.toEqual([unnamed]);
      });
    });
  });
});
