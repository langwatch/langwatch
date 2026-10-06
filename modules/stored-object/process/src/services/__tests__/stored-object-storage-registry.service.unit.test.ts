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
