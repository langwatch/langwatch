import { AzureBlobStoredObjectDriver } from "@langwatch/stored-object-server";
import { describe, expect, it } from "vitest";
import { createWorkerAzureBlobDriver } from "../worker-object-storage.composition";
import type { WorkerStorageConfig } from "../../platform/config/worker.config";

/**
 * Spec: specs/datasets/dataset-normalization-azure-storage.feature
 *
 * Dataset normalization reuses this factory rather than the general
 * registry's Azure driver, so pinning it here is what keeps both paths
 * agreeing about which account a byte lands in.
 */

const unconfiguredAzure: WorkerStorageConfig["azure"] = {
  backend: "azure",
  authMode: undefined,
  accountName: undefined,
  accountKey: undefined,
  container: undefined,
  endpoint: undefined,
  authorityHost: undefined,
  tokenAudience: undefined,
  allowInsecureTokenEndpointForTests: false,
  identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
};

describe("createWorkerAzureBlobDriver", () => {
  describe("given no AZURE_BLOB_ACCOUNT_NAME configured", () => {
    it("returns undefined rather than resolving credentials", () => {
      expect(createWorkerAzureBlobDriver(unconfiguredAzure)).toBeUndefined();
    });
  });

  describe("given a shared-key Azure Blob account", () => {
    it("builds the Azure Blob driver", () => {
      const driver = createWorkerAzureBlobDriver({
        ...unconfiguredAzure,
        authMode: "sharedKey",
        accountName: "acct",
        accountKey: "key",
        container: "datasets",
      });

      expect(driver).toBeInstanceOf(AzureBlobStoredObjectDriver);
    });
  });
});
