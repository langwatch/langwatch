import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectMetadata,
} from "@langwatch/stored-object-contract";
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBounds,
  createDatasetTestRequestBoundsWith,
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

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG_INLINE = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

async function datasetWith(
  answer: () => StoredObjectMetadata,
  requestBounds = createDatasetTestRequestBounds(),
) {
  const getMetadata = vi.fn(async () => answer());
  const storeFromBytes = vi.fn(
    async () => ({ reference: { id: "object-1", byteLength: 16 } }) as never,
  );
  const storedObjects = createApiFixture<StoredObjectApi>(
    { getMetadata, storeFromBytes },
    "storedObjects",
  );
  const repositories = MemoryDatasetRepositories.create();
  const service = DatasetService.create({
    repository: repositories.datasets,
    records: repositories.records,
    requestBounds,
    attachments: createDatasetTestAttachments(storedObjects),
    inlineAttachments: createDatasetTestInlineAttachments(storedObjects, requestBounds),
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
    repositories.records.listAll({ datasetId: dataset.id, projectId, page: 1, limit: 10 });

  return { service, dataset, getMetadata, storeFromBytes, saveRow, rows };
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

  describe("when an image cell holds a link to another site", () => {
    /** @scenario "A link to another site is saved as I wrote it" */
    it("saves the link as written without reading any file", async () => {
      const { saveRow, getMetadata, storeFromBytes, rows } = await datasetWith(() => {
        throw new StoredObjectNotFoundError();
      });

      await saveRow({ receipt: "https://example.com/a.png" });

      expect(getMetadata).not.toHaveBeenCalled();
      expect(storeFromBytes).not.toHaveBeenCalled();
      expect((await rows()).records[0]?.entry).toMatchObject({
        receipt: "https://example.com/a.png",
      });
    });
  });

  describe("when an image cell holds a picture written inline as base64", () => {
    /** @scenario "A picture written inline in a cell is stored as a file" */
    it("stores the picture and keeps its reference in the cell", async () => {
      const { saveRow, dataset, storeFromBytes, rows } = await datasetWith(() => stored());

      await saveRow({ receipt: PNG_INLINE, note: "kept" });

      expect(storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          purpose: "dataset_attachment",
          ownerId: dataset.id,
          mediaType: "image/png",
          bytes: PNG_BYTES,
        }),
      );
      expect((await rows()).records[0]?.entry).toMatchObject({
        receipt: ref("receipt.png"),
        note: "kept",
      });
    });

    /** @scenario "A picture written inline in a cell is stored as a file" */
    it("stores it the same way when a single row is saved or changed", async () => {
      const { service, dataset, storeFromBytes, rows } = await datasetWith(() => stored());

      const { record } = await service.upsertRecord({
        projectId,
        slugOrId: dataset.id,
        recordId: "row-1",
        updatedRecord: { receipt: PNG_INLINE },
      });
      await service.updateRecord({
        projectId,
        slugOrId: dataset.id,
        recordId: record.id,
        updatedRecord: { receipt: PNG_INLINE, note: "again" },
      });

      expect(storeFromBytes).toHaveBeenCalledTimes(2);
      expect((await rows()).records[0]?.entry).toMatchObject({ receipt: ref("receipt.png") });
    });
  });

  describe("when a file cell holds a document written inline as base64", () => {
    /** @scenario "A file written inline in a file cell is stored as a file" */
    it("stores the document and keeps its reference in the cell", async () => {
      const { saveRow, storeFromBytes, rows } = await datasetWith(() =>
        stored({ mediaType: "application/pdf", filename: "contract.pdf" }),
      );

      await saveRow({ contract: `data:application/pdf;base64,${PNG_BYTES.toString("base64")}` });

      expect(storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "application/pdf" }),
      );
      expect((await rows()).records[0]?.entry).toMatchObject({ contract: ref("contract.pdf") });
    });
  });

  describe("when a text cell holds a picture written inline as base64", () => {
    /** @scenario "An inline picture in a text column is left as text" */
    it("saves the text as written and stores no file", async () => {
      const { saveRow, storeFromBytes, rows } = await datasetWith(() => stored());

      await saveRow({ note: PNG_INLINE });

      expect(storeFromBytes).not.toHaveBeenCalled();
      expect((await rows()).records[0]?.entry).toMatchObject({ note: PNG_INLINE });
    });
  });

  describe("when an image cell holds an inline value that does not decode", () => {
    /** @scenario "An inline value that is not a readable file is refused" */
    it("refuses the row, naming the cell, and stores nothing", async () => {
      const { saveRow, storeFromBytes, rows } = await datasetWith(() => stored());

      await expect(saveRow({ receipt: "data:image/png;base64,not base64!" })).rejects.toMatchObject(
        { code: "dataset_inline_file_unreadable", meta: { column: "receipt" } },
      );
      await expect(saveRow({ receipt: "data:image/svg+xml,<svg/>" })).rejects.toMatchObject({
        code: "dataset_inline_file_unreadable",
      });
      expect(storeFromBytes).not.toHaveBeenCalled();
      expect((await rows()).total).toBe(0);
    });
  });

  describe("when an image cell holds an inline file that is not a picture", () => {
    /** @scenario "An image cell refuses an inline file that is not a picture" */
    it("refuses the row with the image type refusal", async () => {
      const { saveRow, storeFromBytes } = await datasetWith(() => stored());

      await expect(
        saveRow({ receipt: `data:application/pdf;base64,${PNG_BYTES.toString("base64")}` }),
      ).rejects.toMatchObject({ code: "dataset_attachment_type_refused" });
      expect(storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an inline picture is larger than the organization's per-file limit", () => {
    /** @scenario "An inline picture larger than the per-file limit is refused" */
    it("refuses the row naming the limit, before the picture is decoded or stored", async () => {
      const { saveRow, storeFromBytes, rows } = await datasetWith(
        () => stored(),
        createDatasetTestRequestBoundsWith({ attachmentBytes: PNG_BYTES.byteLength - 1 }),
      );

      await expect(saveRow({ receipt: PNG_INLINE })).rejects.toMatchObject({
        code: "dataset_attachment_too_large",
        meta: { maxBytes: PNG_BYTES.byteLength - 1 },
      });
      expect(storeFromBytes).not.toHaveBeenCalled();
      expect((await rows()).total).toBe(0);
    });
  });
});
