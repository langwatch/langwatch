/**
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { storesOwner } from "../config-owner.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [storesOwner], environment }).stores.objectStorage;

describe("object storage settings on the stores owner", () => {
  describe("given a deployment names the Azure backend", () => {
    /** @scenario "The env schema declares the Azure backend variables as first-class keys" */
    it("reads the backend, S3 and Azure leaves as first-class keys", () => {
      const value = read({
        STORED_OBJECTS_BACKEND: "azure",
        LANGWATCH_LOCAL_STORAGE_PATH: "/data/objects",
        S3_BUCKET_NAME: "langwatch-storage",
        AZURE_BLOB_ACCOUNT_NAME: "langwatchstorage",
        AZURE_TENANT_ID: "tenant-1",
      });

      expect(value.backend).toBe("azure");
      expect(value.localRoot).toBe("/data/objects");
      expect(value.s3.bucket).toBe("langwatch-storage");
      expect(value.azure.accountName).toBe("langwatchstorage");
      expect(value.azure.identity.tenantId).toBe("tenant-1");
    });
  });

  describe("given a deployment names a backend nothing implements", () => {
    /** @scenario "An unrecognized STORED_OBJECTS_BACKEND value is rejected, not ignored" */
    it("refuses the boot rather than ignoring the selection", () => {
      expect(() => read({ STORED_OBJECTS_BACKEND: "gcs" })).toThrow(ConfigParseError);
    });
  });
});
