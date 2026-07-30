/**
 * Unit tests for `resolveProjectStorageDestination`'s precedence chain,
 * including the AC37 (issue #4133) Azure Blob write-destination scenarios:
 * BYOC S3 -> STORED_OBJECTS_BACKEND=azure -> S3_BUCKET_NAME -> local FS.
 *
 * Replaces the deleted trip-wire test
 * (project-storage-destination-no-azure.unit.test.ts) now that the "azure"
 * arm has landed — these are the positive scenarios that test pinned as the
 * contract to replace it with.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock("~/env.mjs", () => ({
  env: mockEnv,
}));

vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(),
}));

import { getS3ConfigForProject } from "~/server/dataplane-s3";
import {
  AzureBackendMisconfiguredError,
  resolveProjectStorageDestination,
} from "../project-storage-destination";

const mockGetS3ConfigForProject = vi.mocked(getS3ConfigForProject);

function resetEnv() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
}

beforeEach(() => {
  resetEnv();
  mockGetS3ConfigForProject.mockReset();
  mockGetS3ConfigForProject.mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof getS3ConfigForProject>>,
  );
});

describe("resolveProjectStorageDestination", () => {
  describe("given STORED_OBJECTS_BACKEND=azure with complete Azure config and no private bucket", () => {
    /** @scenario "Operator selects Azure Blob as the stored-objects write backend" */
    it("returns an azure destination carrying the account name and container", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";

      const destination = await resolveProjectStorageDestination("proj_1");

      expect(destination).toEqual({
        kind: "azure",
        accountName: "lwacct",
        container: "lw-container",
      });
    });
  });

  describe.each([
    ["AZURE_BLOB_ACCOUNT_NAME"],
    ["AZURE_BLOB_ACCOUNT_KEY"],
    ["AZURE_BLOB_CONTAINER"],
  ])("given STORED_OBJECTS_BACKEND=azure with %s missing", (missingVariable) => {
    /** @scenario "Azure backend selection fails loud when the Azure config is incomplete" */
    it(`raises a configuration error naming ${missingVariable} and does not fall back`, async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      mockEnv[missingVariable] = undefined;
      // The fallback destinations are configured too, to prove the resolver
      // does NOT quietly fall through to either when azure is misconfigured.
      mockEnv.S3_BUCKET_NAME = "global-bucket";
      mockEnv.LANGWATCH_LOCAL_STORAGE_PATH = "/data/objects";

      await expect(
        resolveProjectStorageDestination("proj_1"),
      ).rejects.toBeInstanceOf(AzureBackendMisconfiguredError);
      await expect(resolveProjectStorageDestination("proj_1")).rejects.toThrow(
        new RegExp(missingVariable),
      );
    });
  });

  describe("given an unrelated STORED_OBJECTS_BACKEND value or none at all", () => {
    /** @scenario "Azure env vars alone never flip the write destination" */
    it("falls back to the global S3 bucket when configured, minting no azure-blob uri", async () => {
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      mockEnv.S3_BUCKET_NAME = "global-bucket";
      // STORED_OBJECTS_BACKEND intentionally left unset.

      const destination = await resolveProjectStorageDestination("proj_1");

      expect(destination).toEqual({ kind: "s3", bucket: "global-bucket" });
    });

    /** @scenario "Azure env vars alone never flip the write destination" */
    it("falls back to the local filesystem when no global bucket is configured either", async () => {
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";

      const destination = await resolveProjectStorageDestination("proj_1");

      expect(destination.kind).toBe("file");
    });
  });

  describe("given STORED_OBJECTS_BACKEND=azure with complete config AND S3_BUCKET_NAME set", () => {
    /** @scenario "The azure toggle beats the global S3 bucket but not a BYOC bucket" */
    it("resolves to azure, not the global S3 bucket", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      mockEnv.S3_BUCKET_NAME = "global-bucket";

      const destination = await resolveProjectStorageDestination("proj_1");

      expect(destination.kind).toBe("azure");
    });
  });

  describe("given STORED_OBJECTS_BACKEND=azure with complete config AND a per-project private bucket", () => {
    /** @scenario "A per-project private dataplane bucket still beats the Azure backend toggle" */
    it("resolves to the project's private S3 bucket, not azure", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      mockGetS3ConfigForProject.mockResolvedValueOnce({
        bucket: "private-bucket",
      } as unknown as Awaited<ReturnType<typeof getS3ConfigForProject>>);

      const destination = await resolveProjectStorageDestination("proj_1");

      expect(destination).toEqual({ kind: "s3", bucket: "private-bucket" });
    });
  });

  describe("given no S3 bucket and no Azure config are present", () => {
    it("falls back to a file destination", async () => {
      const destination = await resolveProjectStorageDestination("proj_x");
      expect(destination.kind).toBe("file");
    });
  });
});
