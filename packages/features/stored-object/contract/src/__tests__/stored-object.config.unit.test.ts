import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { storedObjectServerConfigDefinition } from "../stored-object.config.ts";

describe("stored object server configuration", () => {
  describe("given a deployment names the Azure backend", () => {
    /** @scenario "The env schema declares the Azure backend variables as first-class keys" */
    it("reads the backend, S3 and Azure leaves as first-class keys", () => {
      const value = RuntimeConfig.create({
        name: "stored-object",
        definition: storedObjectServerConfigDefinition,
        source: {
          STORED_OBJECTS_BACKEND: "azure",
          LANGWATCH_LOCAL_STORAGE_PATH: "/data/objects",
          S3_BUCKET_NAME: "langwatch-storage",
          AZURE_BLOB_ACCOUNT_NAME: "langwatchstorage",
          AZURE_TENANT_ID: "tenant-1",
        },
      }).value;

      expect(value.backend).toBe("azure");
      expect(value.localFilesystemRoot).toBe("/data/objects");
      expect(value.s3.bucket).toBe("langwatch-storage");
      expect(value.azure.accountName).toBe("langwatchstorage");
      expect(value.azure.identity.tenantId).toBe("tenant-1");
    });
  });

  describe("given a deployment names a backend nothing implements", () => {
    /** @scenario "An unrecognized STORED_OBJECTS_BACKEND value is rejected, not ignored" */
    it("refuses the boot rather than ignoring the selection", () => {
      expect(() =>
        RuntimeConfig.create({
          name: "stored-object",
          definition: storedObjectServerConfigDefinition,
          source: { STORED_OBJECTS_BACKEND: "gcs" },
        }),
      ).toThrow(InvalidRuntimeConfigError);
    });
  });

  describe("given the spool retention confirmation is absent", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the confirmation as withheld", () => {
      expect(
        RuntimeConfig.create({
          name: "stored-object",
          definition: storedObjectServerConfigDefinition,
          source: {},
        }).value.azureSpoolRetentionConfirmed,
      ).toBe(false);
    });
  });
});
