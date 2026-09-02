/**
 * The one rule an SDK's `experiment_slug` is resolved through.
 *
 * Two things are pinned here and both are wire facts rather than preferences:
 * the four characters the deployment's slug rule pre-replaces before slugify
 * runs (an experiment named `my_batch_run` must reach `my-batch-run`, not
 * `mybatchrun` — a different URL for the same name), and that an existing slug
 * is TAKEN BACK rather than duplicated, which is what makes repeated runs
 * group together.
 */
import type { Experiment, ExperimentService } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";

import { ExperimentFindOrCreateService } from "../experiment-find-or-create.service";

describe("given an SDK naming an experiment by slug", () => {
  describe("when the slug is free", () => {
    it("creates it under the deployment's slug rule", async () => {
      const save = vi.fn(async (input: { requestedSlug: string }) =>
        experimentRow({ slug: input.requestedSlug }),
      );
      const service = ExperimentFindOrCreateService.create(
        experimentService({ tryGetBySlug: async () => null, save }),
      );

      const experiment = await service.resolve({
        projectId: "project-1",
        experimentSlug: "My_Batch:Run?",
        experimentType: "BATCH_EVALUATION_V2",
      });

      expect(experiment.slug).toBe("my-batch-run");
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          requestedSlug: "my-batch-run",
          slugMode: "deduplicate",
          name: "My_Batch:Run?",
          type: "BATCH_EVALUATION_V2",
          workflowId: null,
          workbenchState: null,
        }),
      );
    });
  });

  describe("when the slug is already taken", () => {
    it("takes the existing experiment back rather than creating a second", async () => {
      const save = vi.fn();
      const existing = experimentRow({ id: "experiment_1", slug: "my-batch-run" });
      const service = ExperimentFindOrCreateService.create(
        experimentService({ tryGetBySlug: async () => existing, save }),
      );

      const experiment = await service.resolve({
        projectId: "project-1",
        experimentSlug: "my_batch_run",
        experimentType: "BATCH_EVALUATION_V2",
      });

      expect(experiment.id).toBe("experiment_1");
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("when only an id is sent", () => {
    it("reads that experiment instead of demanding a slug", async () => {
      const getById = vi.fn(async () => experimentRow({ id: "experiment_2" }));
      const service = ExperimentFindOrCreateService.create(experimentService({ getById }));

      const experiment = await service.resolve({
        projectId: "project-1",
        experimentId: "experiment_2",
        experimentType: "DSPY",
      });

      expect(experiment.id).toBe("experiment_2");
      expect(getById).toHaveBeenCalledWith({ projectId: "project-1", id: "experiment_2" });
    });
  });

  describe("when neither identifier is sent", () => {
    it("refuses rather than minting an experiment nobody named", async () => {
      const service = ExperimentFindOrCreateService.create(experimentService({}));

      await expect(
        service.resolve({ projectId: "project-1", experimentType: "DSPY" }),
      ).rejects.toThrow("Either experiment_id or experiment_slug is required");
    });
  });

  describe("when an existing experiment is sent a name", () => {
    it("updates it and PRESERVES the slug already in the customer's URLs", async () => {
      const existing = experimentRow({ id: "experiment_1", slug: "my-batch-run" });
      const save = vi.fn(async () => experimentRow({ id: "experiment_1", slug: "my-batch-run" }));
      const service = ExperimentFindOrCreateService.create(
        experimentService({ tryGetBySlug: async () => existing, save }),
      );

      await service.resolve({
        projectId: "project-1",
        experimentSlug: "my-batch-run",
        experimentType: "BATCH_EVALUATION_V2",
        experimentName: "Nightly sweep",
      });

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "experiment_1",
          name: "Nightly sweep",
          requestedSlug: "my-batch-run",
          slugMode: "preserve-existing",
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------

function experimentRow(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "experiment_0",
    name: null,
    type: "BATCH_EVALUATION_V2",
    slug: "experiment-0",
    projectId: "project-1",
    workflowId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    workbenchState: null,
    workbenchVersion: 0,
    ...overrides,
  };
}

function experimentService(overrides: Partial<ExperimentService>): ExperimentService {
  return {
    getById: async () => {
      throw new Error("getById is not part of this scenario");
    },
    tryGetBySlug: async () => null,
    save: async () => {
      throw new Error("save is not part of this scenario");
    },
    ...overrides,
  } as unknown as ExperimentService;
}
