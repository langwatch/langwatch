/**
 * What a caller receives when a dataset write fails: the handled error a person can act on, and
 * an infrastructure failure left exactly as it was raised.
 */

import { DatasetNameTakenError } from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
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
const columnTypes = [{ name: "input", type: "string" }] as const;

function serviceOver(repositoryOverrides: Partial<MemoryDatasetRepository> = {}) {
  const database = MemoryDatasetDatabase.create();

  return DatasetService.create({
    repository: Object.assign(MemoryDatasetRepository.create({ database }), repositoryOverrides),
    records: MemoryDatasetRecordRepository.create({ database }),
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });
}

describe("given a project that already holds a dataset called Refunds", () => {
  describe("when a second dataset is created under the same name", () => {
    /** @scenario "A domain error raised by the resolver is translated by the middleware" */
    it("raises the handled error for a taken dataset name", async () => {
      const service = serviceOver();
      await service.upsertDataset({ projectId: PROJECT_ID, name: "Refunds", columnTypes });

      const refusal = await service
        .upsertDataset({ projectId: PROJECT_ID, name: "Refunds", columnTypes })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(DatasetNameTakenError);
      expect(refusal).toMatchObject({ code: "dataset_name_taken", httpStatus: 409 });
    });
  });

  describe("when another dataset is renamed to that name", () => {
    it("raises the handled error for a taken dataset name", async () => {
      const service = serviceOver();
      await service.upsertDataset({ projectId: PROJECT_ID, name: "Refunds", columnTypes });
      const other = await service.upsertDataset({
        projectId: PROJECT_ID,
        name: "Returns",
        columnTypes,
      });

      const refusal = await service
        .upsertDataset({
          projectId: PROJECT_ID,
          datasetId: other.id,
          name: "Refunds",
          columnTypes,
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(DatasetNameTakenError);
    });
  });
});

describe("given a database that drops its connection", () => {
  describe("when a dataset is created", () => {
    /** @scenario "An infrastructure failure is left alone by the middleware" */
    it("re-raises the original failure unchanged and undressed", async () => {
      const dropped = new Error("connection terminated unexpectedly");
      const service = serviceOver({
        findBySlug: async () => {
          throw dropped;
        },
      });

      const refusal = await service
        .upsertDataset({ projectId: PROJECT_ID, name: "Refunds", columnTypes })
        .catch((error: unknown) => error);

      expect(refusal).toBe(dropped);
      expect(refusal).not.toBeInstanceOf(HandledError);
    });
  });
});

describe("given a project with no dataset called Refunds", () => {
  describe("when a dataset is created under that name", () => {
    /** @scenario "A successful call passes through the middleware untouched" */
    it("answers the dataset it stored", async () => {
      const created = await serviceOver().upsertDataset({
        projectId: PROJECT_ID,
        name: "Refunds",
        columnTypes,
      });

      expect(created).toMatchObject({ name: "Refunds", slug: "refunds", projectId: PROJECT_ID });
    });
  });
});
