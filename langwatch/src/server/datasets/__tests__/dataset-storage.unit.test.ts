import { beforeEach, describe, expect, it, vi } from "vitest";

// Boundary mock: the storage-destination resolver is the only external
// dependency of the factory. Everything else (impl construction) is real, so
// this verifies the selection branch, not the resolver internals.
const resolveProjectStorageDestination = vi.fn();
vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: (projectId: string) =>
    resolveProjectStorageDestination(projectId),
}));

import { getDatasetStorage } from "../dataset-storage";
import { LocalDatasetStorage } from "../local-dataset-storage";
import { S3DatasetStorage } from "../s3-dataset-storage";

beforeEach(() => {
  resolveProjectStorageDestination.mockReset();
});

describe("getDatasetStorage()", () => {
  describe("when the project resolves to an S3 destination", () => {
    it("returns the S3 implementation", async () => {
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "s3",
        bucket: "some-bucket",
      });

      const storage = await getDatasetStorage("p1");

      expect(storage).toBeInstanceOf(S3DatasetStorage);
    });
  });

  describe("when the project resolves to a file destination", () => {
    it("returns the local implementation", async () => {
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file",
        root: "/var/lib/langwatch/objects",
      });

      const storage = await getDatasetStorage("p1");

      expect(storage).toBeInstanceOf(LocalDatasetStorage);
    });
  });

  describe("when resolving the destination", () => {
    it("passes the projectId through to the resolver", async () => {
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file",
        root: "/var/lib/langwatch/objects",
      });

      await getDatasetStorage("proj-xyz");

      expect(resolveProjectStorageDestination).toHaveBeenCalledWith("proj-xyz");
    });
  });
});
