/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectMetadata,
} from "@langwatch/stored-object-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetService } from "../dataset.service.ts";

const projectId = "project-1";
const ref = (name: string, project = projectId) => `/api/files/${project}/object-1/${name}`;

function stored(overrides: Partial<StoredObjectMetadata> = {}): StoredObjectMetadata {
  return {
    projectId,
    id: "object-1",
    sha256: "a".repeat(64),
    byteLength: 1024,
    mediaType: "image/png",
    filename: "receipt.png",
    mediaTypeVerified: true,
    status: "available",
    audiences: [],
    generation: 1,
    provenance: { purpose: "dataset_attachment", ownerKind: "dataset", ownerId: "dataset-1" },
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

async function datasetWith(answer: () => StoredObjectMetadata) {
  const getMetadata = vi.fn(async () => answer());
  const repositories = MemoryDatasetRepositories.create();
  const service = DatasetService.create({
    repository: repositories.datasets,
    records: repositories.records,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(
      createApiFixture<StoredObjectApi>({ getMetadata }, "storedObjects"),
    ),
  });
  const dataset = await service.upsertDataset({
    projectId,
    name: "Receipts",
    columnTypes: [
      { name: "receipt", type: "image" },
      { name: "contract", type: "file" },
      { name: "note", type: "string" },
    ],
  });
  const saveRow = (entry: Record<string, unknown>) =>
    service.batchCreateRecords({ projectId, slugOrId: dataset.id, entries: [entry] });
  const rows = () =>
    repositories.records.findAll({ datasetId: dataset.id, projectId, page: 1, limit: 10 });

  return { service, dataset, getMetadata, saveRow, rows };
}

describe("DatasetService record writes with attachment references", () => {
  describe("when an image cell holds a file that was never confirmed", () => {
    /** @scenario "A reference to a file that was never confirmed is refused" */
    it("refuses the row, naming the cell", async () => {
      const { saveRow, rows } = await datasetWith(() => stored({ status: "pending" }));

      await expect(saveRow({ receipt: ref("receipt.png") })).rejects.toMatchObject({
        code: "dataset_attachment_reference_refused",
        meta: { reason: "not_confirmed", column: "receipt" },
      });
      expect((await rows()).total).toBe(0);
    });
  });

  describe("when a file cell holds a file uploaded as a dataset import", () => {
    /** @scenario "A reference to a file uploaded for another purpose is refused" */
    it("refuses the row as the wrong purpose", async () => {
      const { saveRow } = await datasetWith(() =>
        stored({
          mediaType: "text/csv",
          filename: "rows.csv",
          provenance: { purpose: "dataset_import", ownerKind: "project", ownerId: projectId },
        }),
      );

      await expect(saveRow({ contract: ref("rows.csv") })).rejects.toMatchObject({
        code: "dataset_attachment_reference_refused",
        meta: { reason: "wrong_purpose", column: "contract" },
      });
    });
  });

  describe("when a file cell names another project's file", () => {
    /** @scenario "A reference to another project's file is refused" */
    it("refuses the row without reading the other project's file", async () => {
      const { saveRow, getMetadata } = await datasetWith(() => stored());

      await expect(saveRow({ contract: ref("contract.pdf", "project-2") })).rejects.toMatchObject({
        code: "dataset_attachment_reference_refused",
        meta: { reason: "not_found", column: "contract" },
      });
      expect(getMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when an image cell holds a confirmed PDF", () => {
    /** @scenario "An image cell refuses a file that is not a picture" */
    it("refuses the row with the image type refusal", async () => {
      const { saveRow } = await datasetWith(() =>
        stored({ mediaType: "application/pdf", filename: "contract.pdf" }),
      );

      await expect(saveRow({ receipt: ref("contract.pdf") })).rejects.toMatchObject({
        code: "dataset_attachment_type_refused",
      });
    });
  });

  describe("when a file cell holds a confirmed PDF", () => {
    /** @scenario "A file cell accepts any kind of file that can be uploaded" */
    it("saves the row with the reference", async () => {
      const { saveRow, rows } = await datasetWith(() =>
        stored({ mediaType: "application/pdf", filename: "contract.pdf" }),
      );

      await saveRow({ contract: ref("contract.pdf") });

      expect((await rows()).records[0]?.entry).toMatchObject({ contract: ref("contract.pdf") });
    });
  });

  describe("when another cell of a row that holds a reference changes", () => {
    /** @scenario "A reference the row already held is not checked again" */
    it("saves the row and keeps the reference without reading the file again", async () => {
      let answer = stored();
      const { service, dataset, saveRow, getMetadata, rows } = await datasetWith(() => answer);
      const [record] = await saveRow({ receipt: ref("receipt.png"), note: "first" });
      answer = stored({ status: "pending" });
      getMetadata.mockClear();

      await service.upsertRecord({
        projectId,
        slugOrId: dataset.id,
        recordId: record!.id,
        updatedRecord: { receipt: ref("receipt.png"), note: "second" },
      });

      expect(getMetadata).not.toHaveBeenCalled();
      expect((await rows()).records[0]?.entry).toMatchObject({
        receipt: ref("receipt.png"),
        note: "second",
      });
    });
  });

  describe("when an image cell holds a link or an inline picture", () => {
    /** @scenario "Links and inline pictures still pass unchanged" */
    it("saves the value as written without reading any file", async () => {
      const { saveRow, getMetadata, rows } = await datasetWith(() => {
        throw new StoredObjectNotFoundError();
      });

      await saveRow({
        receipt: "https://example.com/a.png",
        contract: "data:image/png;base64,AAAA",
      });

      expect(getMetadata).not.toHaveBeenCalled();
      expect((await rows()).records[0]?.entry).toMatchObject({
        receipt: "https://example.com/a.png",
        contract: "data:image/png;base64,AAAA",
      });
    });
  });
});
