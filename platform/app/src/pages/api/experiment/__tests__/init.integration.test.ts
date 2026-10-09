/**
 * @vitest-environment node
 *
 * Integration tests for `findOrCreateExperiment`'s dataset association
 * (issue #6411): an SDK-driven experiment (`experiments.init()`, no
 * Optimization Studio workflow) had no way to record which dataset it ran
 * against, so the experiments list always showed "-" in the Dataset column
 * for it. `experiments.init(slug, { datasetId })` and the batch
 * `log_results` `dataset_id`/`dataset_slug` fields both go through this same
 * function.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExperimentType, type Project } from "~/generated/prisma/client";
import { DatasetNotFoundError } from "../../../../server/datasets/errors";
import { prisma } from "../../../../server/db";
import { getTestUser } from "../../../../utils/testUtils";
import { findOrCreateExperiment } from "../init";

const PROJECT_ID = "test-project-id";

describe("findOrCreateExperiment", () => {
  let project: Project;
  const createdExperimentIds: string[] = [];
  const createdDatasetIds: string[] = [];

  beforeAll(async () => {
    await getTestUser();
    project = await prisma.project.findUniqueOrThrow({
      where: { id: PROJECT_ID },
    });
  });

  afterAll(async () => {
    for (const id of createdExperimentIds) {
      await prisma.experiment
        .delete({ where: { id, projectId: PROJECT_ID } })
        .catch(() => {});
    }
    for (const id of createdDatasetIds) {
      await prisma.dataset
        .delete({ where: { id, projectId: PROJECT_ID } })
        .catch(() => {});
    }
  });

  async function createDataset(name: string) {
    const id = `dataset_${nanoid()}`;
    const dataset = await prisma.dataset.create({
      data: {
        id,
        projectId: PROJECT_ID,
        name,
        slug: name,
        columnTypes: [],
      },
    });
    createdDatasetIds.push(dataset.id);
    return dataset;
  }

  describe("given dataset_id on a new experiment", () => {
    it("persists it on the created experiment", async () => {
      const dataset = await createDataset(`ds-${nanoid(6)}`);
      const slug = `exp-${nanoid(8)}`;

      const experiment = await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
        dataset_id: dataset.id,
      });
      createdExperimentIds.push(experiment.id);

      expect(experiment.datasetId).toBe(dataset.id);
    });
  });

  describe("given dataset_slug on a new experiment", () => {
    it("resolves it to the dataset's id and persists that", async () => {
      const dataset = await createDataset(`ds-${nanoid(6)}`);
      const slug = `exp-${nanoid(8)}`;

      const experiment = await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
        dataset_slug: dataset.slug,
      });
      createdExperimentIds.push(experiment.id);

      expect(experiment.datasetId).toBe(dataset.id);
    });
  });

  describe("given no dataset_id or dataset_slug", () => {
    it("leaves datasetId null, unchanged from before this feature", async () => {
      const slug = `exp-${nanoid(8)}`;

      const experiment = await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
      });
      createdExperimentIds.push(experiment.id);

      expect(experiment.datasetId).toBeNull();
    });
  });

  describe("given an experiment that already exists", () => {
    it("sets datasetId on a later call that names one, and leaves it when later calls name none", async () => {
      const slug = `exp-${nanoid(8)}`;

      const created = await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
      });
      createdExperimentIds.push(created.id);
      expect(created.datasetId).toBeNull();

      const dataset = await createDataset(`ds-${nanoid(6)}`);
      await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
        dataset_id: dataset.id,
      });

      const afterFirstLog = await prisma.experiment.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterFirstLog.datasetId).toBe(dataset.id);

      // A later call for the same run that sends no dataset reference (e.g.
      // a log_results row after the first one already set it) must not wipe
      // out what the first call recorded.
      await findOrCreateExperiment({
        project,
        experiment_slug: slug,
        experiment_type: ExperimentType.BATCH_EVALUATION_V2,
      });

      const afterSecondLog = await prisma.experiment.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterSecondLog.datasetId).toBe(dataset.id);
    });
  });

  describe("given a dataset_id that does not exist", () => {
    it("refuses rather than silently creating an experiment with no dataset", async () => {
      const slug = `exp-${nanoid(8)}`;

      await expect(
        findOrCreateExperiment({
          project,
          experiment_slug: slug,
          experiment_type: ExperimentType.BATCH_EVALUATION_V2,
          dataset_id: "dataset_does_not_exist",
        }),
      ).rejects.toThrow(DatasetNotFoundError);

      // Confirm it didn't get created anyway.
      const found = await prisma.experiment.findUnique({
        where: { projectId_slug: { projectId: PROJECT_ID, slug } },
      });
      expect(found).toBeNull();
    });
  });

  describe("given dataset_id from a different project", () => {
    it("refuses it rather than linking across tenants", async () => {
      const otherProjectId = `other-project-${nanoid(8)}`;
      await prisma.project.create({
        data: {
          id: otherProjectId,
          name: "Other Project",
          slug: `other-project-${nanoid(8)}`,
          apiKey: `other-api-key-${nanoid(8)}`,
          teamId: project.teamId,
          language: "en",
          framework: "test-framework",
        },
      });
      const otherDataset = await prisma.dataset.create({
        data: {
          id: `dataset_${nanoid()}`,
          projectId: otherProjectId,
          name: "other-project-dataset",
          slug: "other-project-dataset",
          columnTypes: [],
        },
      });

      try {
        await expect(
          findOrCreateExperiment({
            project,
            experiment_slug: `exp-${nanoid(8)}`,
            experiment_type: ExperimentType.BATCH_EVALUATION_V2,
            dataset_id: otherDataset.id,
          }),
        ).rejects.toThrow(DatasetNotFoundError);
      } finally {
        await prisma.dataset
          .delete({ where: { id: otherDataset.id } })
          .catch(() => {});
        await prisma.project
          .delete({ where: { id: otherProjectId } })
          .catch(() => {});
      }
    });
  });
});
