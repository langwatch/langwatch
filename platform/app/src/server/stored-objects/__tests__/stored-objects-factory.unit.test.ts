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

import { resolveAzureCredentials } from "../azure-credentials";
import { resolveProjectStorageDestination } from "../project-storage-destination";
import {
  createStorageRegistry,
  maybeAzureDriver,
} from "../stored-objects-factory";

const INJECTED_WORKLOAD_IDENTITY_VARS = [
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_FEDERATED_TOKEN_FILE",
] as const;

/**
 * Snapshot taken once at module load: these are real process.env entries the
 * platform injects, so a developer running on a machine that already has them
 * — or another suite that set them — must get them back exactly as they were.
 * Deleting is not restoring.
 */
const originalWorkloadIdentityEnv = Object.fromEntries(
  INJECTED_WORKLOAD_IDENTITY_VARS.map((key) => [key, process.env[key]]),
);

function clearInjectedWorkloadIdentityEnv() {
  for (const key of INJECTED_WORKLOAD_IDENTITY_VARS) delete process.env[key];
}

function restoreInjectedWorkloadIdentityEnv() {
  for (const key of INJECTED_WORKLOAD_IDENTITY_VARS) {
    const original = originalWorkloadIdentityEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
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
  // When azure IS the selected backend, a misconfiguration is raised rather
  // than swallowed — otherwise every read reports the scheme as unconfigured,
  // contradicting the operator's own setting. Either way, no usable driver.
  let isDriverRegistered = false;
  try {
    isDriverRegistered = maybeAzureDriver() !== undefined;
  } catch {
    isDriverRegistered = false;
  }
  return { isDestinationAzure, isDriverRegistered };
}

/**
 * The invariant, stated in the one direction that encodes the bug: a write
 * resolving to azure MUST come with a registered driver, or every write is an
 * outage. The converse is not an invariant — a registered driver with no azure
 * write destination is the supported legacy-read configuration, so asserting
 * the two answers are always equal would forbid a path the code deliberately
 * supports.
 *
 * Returned rather than asserted so the `expect` stays inside the `it` that
 * owns it: an assertion buried in a helper reports the helper's line, not the
 * case that failed.
 */
function isWriteOutage({
  isDestinationAzure,
  isDriverRegistered,
}: {
  isDestinationAzure: boolean;
  isDriverRegistered: boolean;
}): boolean {
  return isDestinationAzure && !isDriverRegistered;
}

describe("maybeAzureDriver / resolveProjectStorageDestination parity", () => {
  beforeEach(() => {
    resetEnv();
    clearInjectedWorkloadIdentityEnv();
  });

  // These are real process.env values, not the mocked module env, so leaving
  // them set after the last test bleeds into any suite sharing this worker.
  afterEach(() => {
    restoreInjectedWorkloadIdentityEnv();
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
    ["backend not azure at all", {}, false],
  ] as const)("given %s", (_label, env, expectedUsable) => {
    /** @scenario "A resolvable Azure destination always comes with a usable Azure driver" */
    it(`reports azure as usable=${String(expectedUsable)} identically for both the destination resolver and the driver registration`, async () => {
      Object.assign(mockEnv, env);

      const { isDestinationAzure, isDriverRegistered } =
        await evaluateAzureUsability();

      expect(isDestinationAzure).toBe(expectedUsable);
      expect(isDriverRegistered).toBe(expectedUsable);
      expect(isWriteOutage({ isDestinationAzure, isDriverRegistered })).toBe(
        false,
      );
    });
  });

  describe("given azure credentials but no container configured", () => {
    /** @scenario "A historical Azure object resolves without the write-only container" */
    it("dispatches a stored azure-blob URI to the driver rather than rejecting the scheme", async () => {
      // Dispatch, not registration. `maybeAzureDriver() !== undefined` is one
      // step short of the claim: the observable behaviour is StorageRegistry
      // routing the URI, and an unregistered scheme throws there — before any
      // request is made. Asserting the driver exists would let that throw
      // survive the test.
      mockEnv.STORED_OBJECTS_BACKEND = "s3";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "a2V5";

      // Only the outermost boundary is stubbed; everything from the registry
      // down to the signed request is the real code path.
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 404 }));
      try {
        const registry = createStorageRegistry({ projectId: "proj-1" });

        await expect(
          registry.exists("azure-blob://lwacct/written-long-ago/objects/abc"),
        ).resolves.toBe(false);
        // A 404 answered by the driver, so the URI genuinely reached Azure
        // rather than short-circuiting somewhere earlier.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    /** @scenario "Writes still refuse without a container, naming it" */
    it("refuses to resolve a write destination, naming the container", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_AUTH_MODE = "managedIdentity";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";

      const { isDestinationAzure } = await evaluateAzureUsability();

      expect(isDestinationAzure).toBe(false);
      expect(() => resolveAzureCredentials({ purpose: "write" })).toThrow(
        /AZURE_BLOB_CONTAINER/,
      );
    });
  });

  describe("given writes moved to S3 while the Azure settings stay for legacy reads", () => {
    /** @scenario "Choosing S3 for writes does not unregister the Azure driver" */
    it("registers the read driver even though no write resolves to azure", async () => {
      // The row the table above cannot hold, because the two answers
      // legitimately differ here. Registration is deliberately NOT gated on the
      // write toggle (see maybeAzureDriver): an operator migrating off Azure
      // keeps the connection settings so already-written azure-blob:// objects
      // stay readable. Asserting a symmetric invariant would forbid exactly the
      // migration path this code exists to support.
      mockEnv.STORED_OBJECTS_BACKEND = "s3";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "a2V5";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";

      const { isDestinationAzure, isDriverRegistered } =
        await evaluateAzureUsability();

      expect(isDestinationAzure).toBe(false);
      expect(isDriverRegistered).toBe(true);
      expect(isWriteOutage({ isDestinationAzure, isDriverRegistered })).toBe(
        false,
      );
    });
  });

  describe("given azure backend with complete workloadIdentity config (AKS-injected values present)", () => {
    /** @scenario "A resolvable Azure destination always comes with a usable Azure driver" */
    it("reports azure as usable for both the destination resolver and the driver registration", async () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      process.env.AZURE_CLIENT_ID = "client-id";
      process.env.AZURE_TENANT_ID = "tenant-id";
      process.env.AZURE_FEDERATED_TOKEN_FILE =
        "/var/run/secrets/azure/tokens/azure-identity-token";

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
