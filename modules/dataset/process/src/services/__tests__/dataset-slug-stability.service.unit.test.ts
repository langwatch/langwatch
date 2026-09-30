/** A dataset's slug is minted at creation and never follows a rename.
 * Spec: specs/datasets/dataset-slug-stability.feature
 */

import { describe, expect, it } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project-1";
const COLUMNS = [{ name: "input", type: "string" as const }];

function setup() {
  const database = MemoryDatasetDatabase.create();
  const repository = MemoryDatasetRepository.create({ database });
  const service = DatasetService.create({
    repository,
    records: MemoryDatasetRecordRepository.create({ database }),
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });
  const seed = ({ name, slug }: { name: string; slug: string }) =>
    repository.create({ projectId: PROJECT_ID, name, slug, columnTypes: COLUMNS });
  const read = async (id: string) => {
    const row = await repository.findById({ id, projectId: PROJECT_ID, includeArchived: true });
    if (!row) throw new Error(`dataset ${id} vanished`);

    return row;
  };

  return { service, seed, read };
}

describe("dataset slug stability", () => {
  describe("when a dataset is being renamed in the edit drawer", () => {
    /** @scenario "The edit drawer shows the slug the dataset keeps" */
    it("reports the slug the dataset already has", async () => {
      const { service, seed } = setup();
      const dataset = await seed({ name: "Original", slug: "original" });

      const result = await service.validateDatasetName({
        projectId: PROJECT_ID,
        proposedName: "Renamed Dataset",
        excludeDatasetId: dataset.id,
      });

      expect(result).toMatchObject({ available: true, slug: "original" });
    });

    /** @scenario "The edit drawer still flags a name another dataset's slug holds" */
    it("flags a name whose slug another dataset holds", async () => {
      const { service, seed } = setup();
      const alpha = await seed({ name: "Alpha", slug: "alpha" });
      const beta = await seed({ name: "Beta", slug: "beta" });

      const result = await service.validateDatasetName({
        projectId: PROJECT_ID,
        proposedName: "Beta",
        excludeDatasetId: alpha.id,
      });

      expect(result.available).toBe(false);
      expect(result.conflictsWith).toBe(beta.name);
    });
  });

  describe("when a rename is saved", () => {
    /**
     * @scenario "Saving a rename from the UI keeps the slug"
     * @scenario "Renaming a dataset keeps its slug"
     */
    it("keeps the slug", async () => {
      const { service, seed } = setup();
      const dataset = await seed({ name: "Saved", slug: "saved" });

      const updated = await service.upsertDataset({
        projectId: PROJECT_ID,
        datasetId: dataset.id,
        name: "Saved Under A New Name",
        columnTypes: COLUMNS,
      });

      expect(updated.name).toBe("Saved Under A New Name");
      expect(updated.slug).toBe("saved");
    });

    /** @scenario "Update a dataset fails when the new name collides with another dataset's slug" */
    it("refuses a new name whose slug another dataset holds", async () => {
      const { service, seed } = setup();
      const alpha = await seed({ name: "Alpha", slug: "alpha" });
      await seed({ name: "Beta", slug: "beta" });

      await expect(
        service.upsertDataset({
          projectId: PROJECT_ID,
          datasetId: alpha.id,
          name: "Beta",
          columnTypes: COLUMNS,
        }),
      ).rejects.toMatchObject({ code: "dataset_name_taken" });
    });

    /** @scenario "Editing columns of a renamed dataset does not collide on its unchanged name" */
    it("does not collide on an unchanged name whose slug another dataset holds", async () => {
      const { service, seed } = setup();
      const renamed = await seed({ name: "Alpha", slug: "first-alpha" });
      await seed({ name: "Other", slug: "alpha" });

      const updated = await service.upsertDataset({
        projectId: PROJECT_ID,
        datasetId: renamed.id,
        name: "Alpha",
        columnTypes: [{ name: "question", type: "string" }],
      });

      expect(updated.slug).toBe("first-alpha");
      expect(updated.columnTypes).toEqual([{ name: "question", type: "string" }]);
    });
  });

  describe("when a renamed dataset is archived and the archive undone", () => {
    /** @scenario "Undoing an archive restores the slug the dataset kept" */
    it("restores the slug it kept", async () => {
      const { service, seed, read } = setup();
      const dataset = await seed({ name: "Something Else", slug: "kept-slug" });

      await service.archiveOrRestoreDataset({ projectId: PROJECT_ID, datasetId: dataset.id });
      expect((await read(dataset.id)).slug).toMatch(/^kept-slug-archived-/);

      await service.archiveOrRestoreDataset({
        projectId: PROJECT_ID,
        datasetId: dataset.id,
        undo: true,
      });
      const restored = await read(dataset.id);
      expect(restored.slug).toBe("kept-slug");
      expect(restored.archivedAt).toBeNull();
    });
  });

  describe("when a renamed dataset is archived through the REST delete", () => {
    /** @scenario "Archiving a renamed dataset suffixes the slug it kept" */
    it("suffixes the kept slug, not one derived from the name", async () => {
      const { service, seed, read } = setup();
      const dataset = await seed({ name: "Something Else", slug: "kept-slug" });

      await service.archiveDataset({ projectId: PROJECT_ID, slugOrId: "kept-slug" });

      expect((await read(dataset.id)).slug).toMatch(/^kept-slug-archived-/);
    });
  });

  describe("when an archived dataset is archived again", () => {
    it("keeps the slug and time of the first archive", async () => {
      const { service, seed, read } = setup();
      const dataset = await seed({ name: "Twice", slug: "twice" });
      const archive = () =>
        service.archiveOrRestoreDataset({ projectId: PROJECT_ID, datasetId: dataset.id });

      await archive();
      const first = await read(dataset.id);
      await archive();
      const second = await read(dataset.id);

      expect(second.slug).toBe(first.slug);
      expect(second.archivedAt).toEqual(first.archivedAt);
    });
  });
});
