import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorageNotWritableError } from "../errors";

const resolveProjectStorageDestination = vi.fn();

vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: (projectId: string) =>
    resolveProjectStorageDestination(projectId),
}));

const { assertDatasetStorageWritable } = await import("../dataset-storage");

describe("assertDatasetStorageWritable", () => {
  let tempRoot: string;

  beforeEach(async () => {
    resolveProjectStorageDestination.mockReset();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lw-storage-probe-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  describe("given the local filesystem backend", () => {
    describe("when the root is writable", () => {
      it("resolves without error", async () => {
        resolveProjectStorageDestination.mockResolvedValue({
          kind: "file",
          root: path.join(tempRoot, "objects"),
        });

        await expect(
          assertDatasetStorageWritable("project-1"),
        ).resolves.toBeUndefined();
      });

      it("creates the root so the first write does not have to", async () => {
        const root = path.join(tempRoot, "nested", "objects");
        resolveProjectStorageDestination.mockResolvedValue({
          kind: "file",
          root,
        });

        await assertDatasetStorageWritable("project-1");

        await expect(fs.stat(root)).resolves.toBeDefined();
      });
    });

    describe("when the root cannot be created", () => {
      /** @scenario Uploads are refused when storage cannot be written */
      it("throws a handled dataset_storage_not_writable error", async () => {
        // A regular file standing where a directory has to go: mkdir fails with
        // ENOTDIR on every platform, so this reproduces an unwritable root
        // without depending on running as a particular user.
        const blocker = path.join(tempRoot, "blocker");
        await fs.writeFile(blocker, "not a directory");
        resolveProjectStorageDestination.mockResolvedValue({
          kind: "file",
          root: path.join(blocker, "objects"),
        });

        const error = await assertDatasetStorageWritable("project-1").catch(
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(StorageNotWritableError);
        // Assert on the code, not the prose: the message is copy.
        expect((error as StorageNotWritableError).code).toBe(
          "dataset_storage_not_writable",
        );
      });

      it("keeps the path and env vars out of the customer-facing message", async () => {
        const blocker = path.join(tempRoot, "blocker2");
        await fs.writeFile(blocker, "not a directory");
        resolveProjectStorageDestination.mockResolvedValue({
          kind: "file",
          root: path.join(blocker, "objects"),
        });

        const error = (await assertDatasetStorageWritable("project-1").catch(
          (e: unknown) => e,
        )) as StorageNotWritableError;

        expect(error.message).not.toContain("LANGWATCH_LOCAL_STORAGE_PATH");
        expect(error.message).not.toContain(tempRoot);
        // The operator still gets the actionable detail — on the log line.
        expect(error.operatorDetail).toContain("LANGWATCH_LOCAL_STORAGE_PATH");
      });
    });
  });

  describe("given an object-storage backend", () => {
    describe("when the destination is s3", () => {
      it("passes without probing the filesystem", async () => {
        resolveProjectStorageDestination.mockResolvedValue({ kind: "s3" });

        await expect(
          assertDatasetStorageWritable("project-1"),
        ).resolves.toBeUndefined();
      });
    });
  });
});
