/**
 * Issue #6087 — the byte paths that must keep working when Azure is
 * configured with an identity instead of an account key.
 *
 * These exist because the failure they guard against is not a signing bug but
 * a WIRING bug, and it is invisible to the driver's own tests. Before this
 * change the driver-registration gate required an account key, so a keyless
 * install resolved Azure as the write destination and then threw
 * "unregistered scheme" on every PUT — the ingestion pipeline down, with a
 * perfectly healthy driver sitting next to it.
 *
 * `@azure/identity` is mocked so no network or cluster is involved; the point
 * here is which credentials each byte path ends up holding, not the exchange.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, workloadGetToken } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  workloadGetToken: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

vi.mock("@azure/identity", () => ({
  WorkloadIdentityCredential: class {
    getToken = workloadGetToken;
  },
  ManagedIdentityCredential: class {
    getToken = workloadGetToken;
  },
  AzureCliCredential: class {
    getToken = workloadGetToken;
  },
}));

vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(async () => null),
}));

import { AzureDatasetStorage } from "~/server/datasets/azure-dataset-storage";
import { getDatasetStorage } from "~/server/datasets/dataset-storage";
import { resolveAzureCredentials } from "../azure-credentials";
import { resetAzureTokenCacheForTests } from "../azure-token-provider";
import { resolveProjectStorageDestination } from "../project-storage-destination";
import { maybeAzureDriver } from "../stored-objects-factory";

/** A keyless install: identity mode, and no account key anywhere. */
function configureWorkloadIdentity() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockEnv.STORED_OBJECTS_BACKEND = "azure";
  mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";
  mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
  mockEnv.AZURE_BLOB_CONTAINER = "stored-objects";
  process.env.AZURE_CLIENT_ID = "client-id";
  process.env.AZURE_TENANT_ID = "tenant-id";
  process.env.AZURE_FEDERATED_TOKEN_FILE = "/var/run/secrets/azure/token";
  process.env.AZURE_AUTHORITY_HOST = "https://login.microsoftonline.com/";
}

beforeEach(() => {
  resetAzureTokenCacheForTests();
  workloadGetToken.mockReset();
  configureWorkloadIdentity();
});

afterEach(() => {
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_FEDERATED_TOKEN_FILE;
  delete process.env.AZURE_AUTHORITY_HOST;
});

describe("Azure byte paths without an account key", () => {
  describe("given the backend is azure in workload-identity mode", () => {
    /** @scenario "Stored-objects writes succeed in a token-based mode" */
    it("resolves an azure destination without consulting a shared key", async () => {
      const destination = await resolveProjectStorageDestination("proj-1");

      expect(destination).toEqual({
        kind: "azure",
        accountName: "lwacct",
        container: "stored-objects",
      });
      expect(mockEnv.AZURE_BLOB_ACCOUNT_KEY).toBeUndefined();
    });

    /**
     * The regression that motivated this file: a resolvable destination with
     * no registered driver means every write throws on scheme dispatch.
     */
    /** @scenario "Stored-objects writes succeed in a token-based mode" */
    it("registers an azure driver so writes are not rejected as an unregistered scheme", () => {
      expect(maybeAzureDriver()).toBeDefined();
    });

    /** @scenario "Reads of previously persisted azure-blob URIs succeed in a token-based mode" */
    it("registers the same driver for reads of URIs written under shared-key auth", () => {
      // The driver is scheme-scoped, not era-scoped: an azure-blob URI
      // persisted before the switch resolves through exactly this instance.
      const driver = maybeAzureDriver();

      expect(driver).toBeDefined();
      expect(typeof driver?.get).toBe("function");
    });

    /** @scenario "Dataset uploads work in a token-based mode" */
    it("selects the Azure dataset storage rather than crashing on an absent key", async () => {
      // Previously this path dereferenced env.AZURE_BLOB_ACCOUNT_KEY! and
      // died inside Buffer.from(undefined) — a crash, not a config error.
      const storage = await getDatasetStorage("proj-1");

      expect(storage).toBeInstanceOf(AzureDatasetStorage);
    });

    /** @scenario "Out-of-band maintenance tasks authenticate the same way as the services" */
    it("hands every consumer the same credentials from the one resolver", async () => {
      const credentials = resolveAzureCredentials();

      // The maintenance tasks reach storage through getDatasetStorage and the
      // destination resolver, both of which route through resolveAzureCredentials.
      const destination = await resolveProjectStorageDestination("proj-1");

      expect(credentials.mode).toBe("workloadIdentity");
      expect(credentials).not.toHaveProperty("accountKey");
      expect(destination).toMatchObject({ accountName: credentials.accountName });
    });
  });

  describe("given the backend is azure in shared-key mode", () => {
    /** @scenario "Azure authentication defaults to shared key when no mode is set" */
    it("still requires and uses the account key", async () => {
      delete mockEnv.AZURE_BLOB_AUTH_MODE;
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = Buffer.from("key").toString("base64");

      const credentials = resolveAzureCredentials();

      expect(credentials.mode).toBe("sharedKey");
      expect(maybeAzureDriver()).toBeDefined();
      await expect(resolveProjectStorageDestination("proj-1")).resolves.toMatchObject({
        kind: "azure",
      });
    });
  });
});
