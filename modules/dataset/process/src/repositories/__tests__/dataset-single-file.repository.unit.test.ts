import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FilesystemDatasetSingleFileRepository } from "../filesystem/filesystem.dataset-single-file.repository.ts";

describe("FilesystemDatasetSingleFileRepository", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dataset-single-file-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("given the previous release stored datasets on local disk at a path", () => {
    /** @scenario "Single-file datasets the previous release kept on local disk are read from its storage path" */
    it("reads the file under the project and dataset ids, and reports a missing one", async () => {
      await fs.mkdir(path.join(root, "project_a"));
      await fs.writeFile(path.join(root, "project_a", "dataset_a"), "[]", "utf8");
      const files = FilesystemDatasetSingleFileRepository.create({ localPath: root });

      await expect(
        files.getSingleFile({ projectId: "project_a", datasetId: "dataset_a" }),
      ).resolves.toEqual({ outcome: "found", text: "[]" });
      await expect(
        files.getSingleFile({ projectId: "project_a", datasetId: "dataset_gone" }),
      ).resolves.toEqual({ outcome: "missing" });
    });
  });
});
