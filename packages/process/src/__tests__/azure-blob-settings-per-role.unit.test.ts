/**
 * @see specs/features/scenarios/azure-blob-workload-identity.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";

const AZURE_BLOB_BLOCK = {
  STORED_OBJECTS_BACKEND: "azure",
  AZURE_BLOB_AUTH_MODE: "workloadIdentity",
  AZURE_BLOB_ACCOUNT_NAME: "langwatchstorage",
  AZURE_BLOB_CONTAINER: "objects",
  AZURE_BLOB_ENDPOINT: "https://langwatchstorage.blob.core.windows.net",
  AZURE_TENANT_ID: "tenant-1",
  AZURE_CLIENT_ID: "client-1",
  AZURE_FEDERATED_TOKEN_FILE: "/var/run/secrets/azure/tokens/azure-identity-token",
};

const azureSettingsFor = (role: "api" | "worker") =>
  parseProcessConfig({ owners: processConfig([], role), environment: AZURE_BLOB_BLOCK }).stores
    .objectStorage.azure;

describe("given the AZURE_BLOB_* block the App composes its Azure Blob config from", () => {
  describe("when the worker resolves its own configuration", () => {
    /** @scenario "Azure dataset normalization reads the same AZURE_BLOB_* block as the App" */
    it("reads the same Azure Blob account settings as the App", () => {
      const worker = azureSettingsFor("worker");

      expect(worker).toEqual(azureSettingsFor("api"));
      expect(worker).toMatchObject({
        accountName: "langwatchstorage",
        container: "objects",
        identity: { tenantId: "tenant-1", clientId: "client-1" },
      });
    });
  });
});
