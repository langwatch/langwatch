/**
 * What the resolver does with a destination this process composed no driver for.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DatasetObjectStorageResolverAdapter,
  DatasetStorageDestinationPort,
  type DatasetStorageDestination,
} from "../dataset-object-storage-resolver.adapter";
import { LocalDatasetStorageAdapter } from "../local.dataset-storage.adapter";
import { S3DatasetStorageAdapter } from "../s3.dataset-storage.adapter";
import { DatasetS3ClientResolver } from "../../ports/dataset-storage.port";

class FixedDestination extends DatasetStorageDestinationPort {
  constructor(private readonly destination: DatasetStorageDestination) {
    super();
  }
  async resolve(): Promise<DatasetStorageDestination> {
    return this.destination;
  }
}

class RecordingS3Resolver extends DatasetS3ClientResolver {
  readonly acquire = vi.fn(async () => {
    throw new Error("The S3 client must never be acquired for a non-S3 destination");
  });
}

function resolverFor(destination: DatasetStorageDestination) {
  const s3ClientResolver = new RecordingS3Resolver();
  return {
    s3ClientResolver,
    resolver: DatasetObjectStorageResolverAdapter.create({
      destination: new FixedDestination(destination),
      s3ClientResolver,
    }),
  };
}

describe("DatasetObjectStorageResolverAdapter", () => {
  describe("given a project whose destination is azure and a process that composed no Azure driver", () => {
    /** @scenario "The legacy S3 client factory refuses an azure destination instead of inventing a bucket" */
    it("refuses by name instead of falling through to the S3 adapter", async () => {
      const { resolver, s3ClientResolver } = resolverFor({ kind: "azure" });

      await expect(resolver.forProject("project-1")).rejects.toThrow(/Azure/);
      expect(s3ClientResolver.acquire).not.toHaveBeenCalled();
    });
  });

  describe("given a project whose destination is s3", () => {
    it("selects the S3 adapter", async () => {
      const { resolver } = resolverFor({ kind: "s3" });

      await expect(resolver.forProject("project-1")).resolves.toBeInstanceOf(
        S3DatasetStorageAdapter,
      );
    });
  });

  describe("given a project whose destination is the local filesystem", () => {
    it("selects the local adapter rooted where the destination says", async () => {
      const { resolver } = resolverFor({ kind: "file", root: "/var/lib/langwatch/objects" });

      await expect(resolver.forProject("project-1")).resolves.toBeInstanceOf(
        LocalDatasetStorageAdapter,
      );
    });
  });
});
