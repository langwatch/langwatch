/**
 * Regression cover for the storage-registry factory (langwatch-agent review on
 * PR #6092).
 *
 * The defect: `resolveProjectStorageDestination` trims `AZURE_BLOB_*` before
 * minting `azure-blob://{account}/...`, but the factory built the driver from
 * the raw env values. A padded Kubernetes Secret — `AZURE_BLOB_ACCOUNT_NAME=" lwacct "`,
 * which a here-doc or a YAML block scalar produces easily — therefore passed
 * the resolver's validation and then had the driver address
 * `https:// lwacct .blob.core.windows.net`, an invalid host, for every
 * stored-object and tiered-blob operation. The URI said one account, the
 * connection went to another.
 *
 * Asserting on the credentials the driver is CONSTRUCTED with, rather than on
 * a request, because that is where the two sides diverged.
 */
import { describe, expect, it, vi } from "vitest";

const { mockEnv, driverConstructorCalls } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  driverConstructorCalls: [] as unknown[],
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

vi.mock("../azure-blob-driver", () => ({
  AzureBlobDriver: class {
    constructor(credentials: unknown) {
      driverConstructorCalls.push(credentials);
    }
  },
}));

vi.mock("../s3-driver", () => ({ S3Driver: class {} }));
vi.mock("../local-filesystem-driver", () => ({
  LocalFilesystemDriver: class {},
}));

import { createStorageRegistry } from "../stored-objects-factory";

function resetEnv() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  driverConstructorCalls.length = 0;
}

describe("createStorageRegistry()", () => {
  describe("given Azure credentials arrive padded with whitespace", () => {
    it("builds the driver from trimmed values so the URI and the endpoint agree", () => {
      resetEnv();
      // Every value padded: the container is part of "is Azure usable at all",
      // so it has to be present here, and padding it proves the same
      // normalization covers it.
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "  lwacct  ";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "  a2V5  ";
      mockEnv.AZURE_BLOB_CONTAINER = "  lw-container  ";
      mockEnv.AZURE_BLOB_ENDPOINT = "  https://lwacct.blob.core.windows.net  ";

      createStorageRegistry({ projectId: "proj-1" });

      expect(driverConstructorCalls).toHaveLength(1);
      expect(driverConstructorCalls[0]).toMatchObject({
        accountName: "lwacct",
        accountKey: "a2V5",
        endpointBaseUrl: "https://lwacct.blob.core.windows.net",
      });
    });
  });

  describe("given no Azure credentials are configured", () => {
    it("registers no Azure driver rather than one with empty credentials", () => {
      resetEnv();

      createStorageRegistry({ projectId: "proj-1" });

      expect(driverConstructorCalls).toHaveLength(0);
    });
  });

  describe("given only whitespace is configured", () => {
    it("treats it as absent rather than building a driver with a blank account", () => {
      resetEnv();
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "   ";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "   ";
      mockEnv.AZURE_BLOB_CONTAINER = "   ";

      createStorageRegistry({ projectId: "proj-1" });

      expect(driverConstructorCalls).toHaveLength(0);
    });
  });
});
