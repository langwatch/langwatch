import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { StoredObjectStorageRegistryService } from "../stored-object-storage-registry.service.ts";

const driver = {
  get: async () => {
    throw new Error("not implemented");
  },
  put: async () => undefined,
  delete: async () => undefined,
  exists: async () => false,
};

describe("StoredObjectStorageRegistryService", () => {
  describe("given a provider registered as a factory", () => {
    it("constructs it only when its scheme is first used", async () => {
      let azureCalls = 0;
      const registry = StoredObjectStorageRegistryService.create({
        s3: driver,
        file: driver,
        "azure-blob": () => {
          azureCalls += 1;
          return driver;
        },
      });

      expect(azureCalls).toBe(0);
      await expect(registry.exists("azure-blob://account/container/key")).resolves.toBe(false);
      await expect(registry.exists("azure-blob://account/container/key")).resolves.toBe(false);
      expect(azureCalls).toBe(1);
    });
  });
});

describe("given a registry with both the S3 and the filesystem driver registered", () => {
  const served = (from: string) => ({
    ...driver,
    get: async () => Readable.from([from]),
  });
  const registry = StoredObjectStorageRegistryService.create({
    s3: served("s3-driver"),
    file: served("file-driver"),
  });
  const read = async (uri: string) => {
    const chunks: Buffer[] = [];
    for await (const chunk of await registry.get(uri)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };

  /** @scenario "Storage registry dispatches by URI scheme" */
  it("sends an s3 URI to the S3 driver and a file URI to the filesystem driver", async () => {
    expect(await read("s3://bucket/project-1/object-1")).toBe("s3-driver");
    expect(await read("file:///data/project-1/object-1")).toBe("file-driver");
  });
});
