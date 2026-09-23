import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import type { DatasetStorageResolver } from "../../app/dataset.app.ts";
import type { CreateDatasetInput } from "../../repositories/dataset-content.repository.ts";
import { MemoryDatasetContentRepository } from "../../repositories/memory/memory.dataset-content.repository.ts";
import { MemoryDatasetRecordContentRepository } from "../../repositories/memory/memory.dataset-record-content.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { DatasetUploadService } from "../dataset-upload.service.ts";
import { LocalDatasetStorage } from "../local.dataset-storage.service.ts";

/** A no-S3 (single-replica self-host) resolver: every project's storage is the
 * real LocalDatasetStorage on a temp filesystem root — no S3 configured. */
function localOnlyResolver(root: string): DatasetStorageResolver {
  const storage = new LocalDatasetStorage(root);
  return { forProject: async () => storage };
}

describe("Dataset self-hosted storage", () => {
  it("keeps local storage injectable with same-origin staging", async () => {
    const storage = new LocalDatasetStorage("/tmp/langwatch-dataset-test");
    await expect(storage.createPresignedUpload({ projectId: "p1" })).resolves.toMatchObject({
      url: expect.stringContaining("/api/dataset/direct-upload/staging/"),
    });
  });

  describe("given a self-hosted install without object storage", () => {
    describe("when I create and read a dataset", () => {
      /** @scenario "Datasets work on a minimal self-hosted install" */
      it("creates the dataset directly on local storage and reads its rows back", async () => {
        const root = path.join(os.tmpdir(), `lw-ds-selfhost-${nanoid()}`);
        const created: CreateDatasetInput[] = [];
        const database = MemoryDatasetDatabase.create();
        const stored = MemoryDatasetContentRepository.create({ database });
        const datasets = Object.assign(MemoryDatasetContentRepository.create({ database }), {
          create: async (input: CreateDatasetInput) => {
            created.push(input);
            return stored.create(input);
          },
        });
        const records = MemoryDatasetRecordContentRepository.create({ database });
        const adapter = DatasetUploadService.create({
          datasets,
          records,
          storageResolver: localOnlyResolver(root),
        });

        const result = await adapter.createDatasetFromUpload({
          projectId: "p1",
          name: "Local Set",
          filename: "data.csv",
          content: "question,answer\nWhat is 2+2?,4\n",
          fileSize: 30,
        });

        expect(result).toMatchObject({ name: "Local Set", recordsCreated: 1 });
        expect(created[0]).toMatchObject({ contentLayout: "s3_jsonl", status: "ready" });

        const storage = new LocalDatasetStorage(root);
        const rows = await storage.readChunk({ projectId: "p1", datasetId: result.id, index: 0 });
        expect(rows).toHaveLength(1);

        await fs.rm(root, { recursive: true, force: true });
      });
    });

    describe("when I upload a CSV larger than the in-browser limit", () => {
      /** @scenario "A large file uploads on a self-hosted install with no object storage" */
      it("accepts the upload without requiring object storage and streams it to local disk", async () => {
        const root = path.join(os.tmpdir(), `lw-ds-selfhost-large-${nanoid()}`);
        const database = MemoryDatasetDatabase.create();
        const datasets = MemoryDatasetContentRepository.create({ database });
        const records = MemoryDatasetRecordContentRepository.create({ database });
        const adapter = DatasetUploadService.create({
          datasets,
          records,
          storageResolver: localOnlyResolver(root),
        });

        const pending = await adapter.createPendingUpload({
          projectId: "p1",
          name: "Big Local",
          filename: "big.csv",
        });
        // Same-origin staging URL — no S3 required, no "requires object storage" error.
        expect(pending.uploadUrl).toMatch(/^\/api\/dataset\/direct-upload\/staging\//);

        const body = new Readable({ read() {} });
        body.push(Buffer.from("question,answer\nWhat is 2+2?,4\n", "utf8"));
        body.push(null);
        const { stagingKey } = await datasets.getOne({ id: pending.datasetId, projectId: "p1" });
        const uploadId = stagingKey!.split("/").pop()!;
        await adapter.writeStagedUpload({ projectId: "p1", uploadId, body });

        const finalized = await adapter.finalizeUpload({
          datasetId: pending.datasetId,
          projectId: "p1",
        });
        expect(finalized.status).toBe("processing");

        await fs.rm(root, { recursive: true, force: true });
      });
    });
  });
});
