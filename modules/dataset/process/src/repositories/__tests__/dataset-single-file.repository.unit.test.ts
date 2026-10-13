import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { memoryObjectStorage } from "@langwatch/process-stores";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FilesystemDatasetSingleFileRepository } from "../filesystem/filesystem.dataset-single-file.repository.ts";
import { ObjectStorageDatasetSingleFileRepository } from "../object-storage/object-storage.dataset-single-file.repository.ts";

const key = { projectId: "project_a", datasetId: "dataset_a" };

describe("FilesystemDatasetSingleFileRepository", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dataset-single-file-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("given the previous release kept datasets on local disk at a path", () => {
    /** @scenario "Single-file datasets on local disk live at the previous release's path" */
    it("reads and writes the file under the project and dataset ids", async () => {
      await fs.mkdir(path.join(root, "project_a"));
      await fs.writeFile(path.join(root, "project_a", "dataset_a"), "[]", "utf8");
      const files = FilesystemDatasetSingleFileRepository.create({ localPath: root });

      await expect(files.getSingleFile(key)).resolves.toEqual({ outcome: "found", text: "[]" });
      await files.putSingleFile({ ...key, text: '[{"id":"r","entry":{}}]' });
      await expect(fs.readFile(path.join(root, "project_a", "dataset_a"), "utf8")).resolves.toBe(
        '[{"id":"r","entry":{}}]',
      );
      await expect(
        files.getSingleFile({ projectId: "project_a", datasetId: "dataset_gone" }),
      ).resolves.toEqual({ outcome: "missing" });
    });

    it("refuses ids that climb out of the storage path", async () => {
      const files = FilesystemDatasetSingleFileRepository.create({ localPath: root });

      await expect(
        files.getSingleFile({ projectId: "..", datasetId: "dataset_a" }),
      ).rejects.toThrow("path traversal");
    });
  });
});

describe("ObjectStorageDatasetSingleFileRepository", () => {
  describe("given the previous release kept datasets in object storage", () => {
    /** @scenario "Single-file datasets in object storage live at the previous release's key" */
    it("reads and writes the object at datasets/<project>/<dataset>", async () => {
      const objectStorage = memoryObjectStorage();
      const files = ObjectStorageDatasetSingleFileRepository.create({ objectStorage });

      await expect(files.getSingleFile(key)).resolves.toEqual({ outcome: "missing" });
      await files.putSingleFile({ ...key, text: "[]" });

      const body = await objectStorage.read({
        projectId: "project_a",
        key: "datasets/project_a/dataset_a",
      });
      const parts: Uint8Array[] = [];
      for await (const part of body) parts.push(part);
      expect(Buffer.concat(parts).toString("utf8")).toBe("[]");
      await expect(files.getSingleFile(key)).resolves.toEqual({ outcome: "found", text: "[]" });
    });
  });
});
