/**
 * Unit tests pinning the parity invariant between `maybeAzureDriver`
 * (stored-objects-factory.ts, driver registration) and
 * `resolveProjectStorageDestination`'s azure branch (destination
 * resolution) — issue #6087.
 *
 * Before `resolveAzureCredentials()` existed, the two sites decided
 * independently what "Azure is configured" meant: the destination resolver
 * required only accountName/accountKey/container, while the driver
 * registration ALSO required accountKey even in a token-based mode — so a
 * token-mode deployment would resolve every write to azure-blob:// while no
 * driver was registered to serve it, a write outage. Both now call the same
 * `resolveAzureCredentials()`, so this must never happen again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

// stored-objects-factory.ts transitively imports StoredObjectsService /
// StoredObjectsRepository, which call getLangWatchTracer / createLogger /
// the metrics registry at MODULE TOP LEVEL — mocked here purely so
// importing the factory doesn't touch the real OTEL/Prometheus/S3 wiring,
// matching stored-objects.service.unit.test.ts's mock set. This suite never
// instantiates StoredObjectsService itself, only `maybeAzureDriver`.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/env.mjs", () => ({
  env: mockEnv,
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn().mockResolvedValue(null),
}));

import { maybeAzureDriver } from "../stored-objects-factory";
import { resolveProjectStorageDestination } from "../project-storage-destination";

function clearInjectedWorkloadIdentityEnv() {
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_FEDERATED_TOKEN_FILE;
}

function resetEnv() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
}

async function evaluateAzureUsability(): Promise<{
  isDestinationAzure: boolean;
  isDriverRegistered: boolean;
}> {
  let isDestinationAzure = false;
  try {
    const destination = await resolveProjectStorageDestination("proj-1");
    isDestinationAzure = destination.kind === "azure";
  } catch {
    isDestinationAzure = false;
  }
  const isDriverRegistered = maybeAzureDriver() !== undefined;
  return { isDestinationAzure, isDriverRegistered };
}

describe("maybeAzureDriver / resolveProjectStorageDestination parity", () => {
  beforeEach(() => {
    resetEnv();
    clearInjectedWorkloadIdentityEnv();
  });

  // These are real process.env values, not the mocked module env, so leaving
  // them set after the last test bleeds into any suite sharing this worker.
  afterEach(() => {
    clearInjectedWorkloadIdentityEnv();
  });

  describe.each([
    [
      "azure backend, complete sharedKey config",
      {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_ACCOUNT_KEY: "key-value",
        AZURE_BLOB_CONTAINER: "lw-container",
      },
      true,
    ],
    [
      "azure backend, complete managedIdentity config",
      {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_AUTH_MODE: "managedIdentity",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_CONTAINER: "lw-container",
      },
      true,
    ],
    [
      "azure backend, complete azureCli config",
      {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_AUTH_MODE: "azureCli",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_CONTAINER: "lw-container",
      },
      true,
    ],
    [
      "azure backend, sharedKey missing the account key",
      {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_CONTAINER: "lw-container",
      },
      false,
    ],
    [
      "azure backend, managedIdentity missing the container",
      {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_AUTH_MODE: "managedIdentity",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
      },
      false,
    ],
    [
      "backend not azure at all",
      {},
      false,
    ],
  ] as const)(
    "given %s",
    (_label, env, expectedUsable) => {
      /** @scenario "A resolvable Azure destination always comes with a usable Azure driver" */
      it(`reports azure as usable=${String(expectedUsable)} identically for both the destination resolver and the driver registration`, async () => {
        Object.assign(mockEnv, env);

        const { isDestinationAzure, isDriverRegistered } =
        await evaluateAzureUsability();

        expect(isDestinationAzure).toBe(expectedUsable);
        expect(isDriverRegistered).toBe(expectedUsable);
        // The invariant itself: never one true and the other false.
        expect(isDestinationAzure).toBe(isDriverRegistered);
      });
    },
  );

  describe("given azure backend with complete workloadIdentity config (AKS-injected values present)", () => {
    /** @scenario "A resolvable Azure destination always comes with a usable Azure driver" */
    it("reports azure as usable for both the destination resolver and the driver registration", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      process.env.AZURE_CLIENT_ID = "client-id";
      process.env.AZURE_TENANT_ID = "tenant-id";
      process.env.AZURE_FEDERATED_TOKEN_FILE = "/var/run/secrets/azure/tokens/azure-identity-token";

      const { isDestinationAzure, isDriverRegistered } =
        await evaluateAzureUsability();

      expect(isDestinationAzure).toBe(true);
      expect(isDriverRegistered).toBe(true);
    });
  });

  describe("given azure backend with workloadIdentity but no AKS-injected values (webhook never mutated the pod)", () => {
    /** @scenario "A resolvable Azure destination always comes with a usable Azure driver" */
    it("reports azure as unusable for both the destination resolver and the driver registration", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      // AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_FEDERATED_TOKEN_FILE
      // deliberately left unset.

      const { isDestinationAzure, isDriverRegistered } =
        await evaluateAzureUsability();

      expect(isDestinationAzure).toBe(false);
      expect(isDriverRegistered).toBe(false);
    });
  });
});
