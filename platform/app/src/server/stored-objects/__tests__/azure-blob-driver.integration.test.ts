/**
 * @vitest-environment node
 * @integration
 *
 * AC37 (issue #4133) — "Scenario media round-trips through Azure Blob when
 * azure is the configured backend" / "the Azurite emulator uses path-style
 * addressing".
 *
 * Exercises the real signing + wire path against a live Azurite emulator
 * (testcontainers), NOT a mocked fetch: a subtly wrong path-style
 * canonicalised resource produces a well-formed-looking SharedKey header that
 * only a real emulator rejects with 403 — the unit-level KAT tests can't
 * catch that class of bug because they never send the request anywhere.
 *
 *  1. `AzureBlobDriver` put/get/delete/exists round-trip real bytes through
 *     Azurite with path-style addressing (the driver-level contract).
 *  2. `StoredObjectsService.storeFromBytes` persists a row whose
 *     `storage_uri` is an `azure-blob://` URI, and `getById` streams the
 *     bytes back through the `StorageRegistry` — the same registry dispatch
 *     `GET /api/files/:id` uses.
 *
 * Uses:
 *  - testcontainers Azurite for the real Azure Blob emulator
 *  - testcontainers ClickHouse (via startTestContainers) for the real
 *    stored_objects row
 */
import crypto from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import { mintAzureBlobStoredObjectUri } from "@langwatch/stored-object-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { AzureBlobDriver } from "../azure-blob-driver";
import { StorageRegistry } from "../storage-registry";
import { StoredObjectsRepository } from "../stored-objects.repository";
import type { MintStorageUri } from "../stored-objects.service";
import { StoredObjectsService } from "../stored-objects.service";
import {
  ensureAzuriteContainer,
  type StartedAzurite,
  startAzurite,
  stopAzurite,
} from "./azurite-test-support";

// env mock — the driver and service receive explicit config in this test;
// the mock only exists so the real env.mjs does not fail validation on
// missing variables in the test environment (same pattern as the sibling
// integration tests in this directory).
vi.mock("~/env.mjs", () => ({
  env: { S3_BUCKET_NAME: "" },
}));

const resolveClientMock = vi.fn();
// The repository reads `getApp().clickhouse.resolveClient` (two-door access);
// the actual client reference lands in beforeAll once the container starts.
vi.mock("~/server/app-layer/app", () => {
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: (...args: unknown[]) => resolveClientMock(...args),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

const CONTAINER = "stored-objects";
const PROJECT = `test-so-azure-${nanoid(6)}`;

let ch: ClickHouseClient;
let azurite: StartedAzurite;
let driver: AzureBlobDriver;

function sha256Of(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function waitForRow(
  client: ClickHouseClient,
  projectId: string,
  id: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.query({
      query: `SELECT id FROM stored_objects WHERE project_id = {projectId:String} AND id = {id:String} LIMIT 1`,
      query_params: { projectId, id },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ id: string }>();
    if (rows.length > 0) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

beforeAll(async () => {
  azurite = await startAzurite();
  await ensureAzuriteContainer({ azurite, container: CONTAINER });
  driver = new AzureBlobDriver({
    mode: "sharedKey",
    accountName: azurite.accountName,
    accountKey: azurite.accountKey,
    endpointBaseUrl: azurite.endpointBaseUrl,
  });

  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  resolveClientMock.mockResolvedValue(ch);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE stored_objects DELETE WHERE project_id = {projectId:String}`,
      query_params: { projectId: PROJECT },
    });
  }
  await stopTestContainers();
  await stopAzurite(azurite);
}, 60_000);

describe("AzureBlobDriver against a real Azurite emulator (path-style addressing)", () => {
  describe("given real bytes", () => {
    /** @scenario "Scenario media round-trips through Azure Blob when azure is the configured backend" */
    it("round-trips put/get/exists/delete through Azurite with a correctly signed path-style request", async () => {
      const bytes = Buffer.from("azurite round-trip payload", "utf8");
      const uri = mintAzureBlobStoredObjectUri({
        accountName: azurite.accountName,
        container: CONTAINER,
        projectId: PROJECT,
        sha256: sha256Of(bytes),
      });

      await driver.put(uri, bytes, "text/plain");
      expect(await driver.exists(uri)).toBe(true);

      const stream = await driver.get(uri);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("azurite round-trip payload");

      await driver.delete(uri);
      expect(await driver.exists(uri)).toBe(false);
    });
  });

  describe("given a custom endpoint pasted with a trailing slash", () => {
    /**
     * Regression (langwatch-agent review on PR #6092). URLs are built as
     * `${endpoint}/${container}/${blobPath}`, so a trailing slash sent
     * `//container/blob` while the signature canonicalised `/container/blob`.
     * Azurite answers 400 Bad Request — verified before the fix. A trailing
     * slash is a normal thing to paste out of the portal.
     */
    it("round-trips anyway, because the endpoint is normalised once", async () => {
      const driverWithSlash = new AzureBlobDriver({
        mode: "sharedKey",
        accountName: azurite.accountName,
        accountKey: azurite.accountKey,
        endpointBaseUrl: `${azurite.endpointBaseUrl}/`,
      });
      const bytes = Buffer.from("trailing slash payload", "utf8");
      const uri = mintAzureBlobStoredObjectUri({
        accountName: azurite.accountName,
        container: CONTAINER,
        projectId: PROJECT,
        sha256: sha256Of(bytes),
      });

      await driverWithSlash.put(uri, bytes, "text/plain");
      expect(await driverWithSlash.exists(uri)).toBe(true);

      const stream = await driverWithSlash.get(uri);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("trailing slash payload");

      await driverWithSlash.delete(uri);
    });
  });

  describe("given a zero-byte body", () => {
    /**
     * Regression (ruthless-review P1 on PR #6092): `put()` used to sign
     * Content-Length as "0", but the shared-key spec requires the EMPTY
     * STRING for an empty body — Azurite answered 403 AuthorizationFailure.
     * This executes the real PUT rather than asserting on the signature
     * string, because the defect only shows as a runtime rejection.
     *
     * Reachable in production via a zero-byte staged dataset upload:
     * `AzureDatasetStorage.putStaged` caps size but has no minimum.
     */
    it("stores and reads back an empty blob instead of failing authorization", async () => {
      const bytes = Buffer.alloc(0);
      const uri = mintAzureBlobStoredObjectUri({
        accountName: azurite.accountName,
        container: CONTAINER,
        projectId: PROJECT,
        sha256: sha256Of(bytes),
      });

      await driver.put(uri, bytes, "application/octet-stream");
      expect(await driver.exists(uri)).toBe(true);
      expect(await driver.head(uri)).toBe(0);

      // Actually read it: a signed GET of a zero-length blob is its own case,
      // not implied by exists() or head(). This is the suite that runs in CI.
      const stream = await driver.get(uri);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toHaveLength(0);

      await driver.delete(uri);
    });
  });
});

describe("StoredObjectsService against a real Azurite emulator", () => {
  describe("given STORED_OBJECTS_BACKEND=azure is the resolved destination", () => {
    /** @scenario "An Azure-only installation supports every shared object-storage workload" */
    it("persists an azure-blob storage_uri and streams the bytes back through the StorageRegistry on read", async () => {
      const registry = new StorageRegistry({
        // s3/file are mandatory on the registry but unused by this test —
        // any StorageDriver satisfies the type; azure-blob does the real work.
        s3: driver,
        file: driver,
        "azure-blob": driver,
      });
      const repository = new StoredObjectsRepository();
      const mintUri: MintStorageUri = async ({ projectId, sha256 }) =>
        mintAzureBlobStoredObjectUri({
          accountName: azurite.accountName,
          container: CONTAINER,
          projectId,
          sha256,
        });
      const service = new StoredObjectsService(repository, registry, mintUri);

      const bytes = Buffer.from("azure media payload", "utf8");
      const stored = await service.storeFromBytes({
        projectId: PROJECT,
        purpose: "scenario_event",
        ownerKind: "scenario_run",
        ownerId: `run-${nanoid(6)}`,
        mediaType: "text/plain",
        bytes,
      });

      expect(await waitForRow(ch, PROJECT, stored.id)).toBe(true);

      const result = await service.getById({
        projectId: PROJECT,
        id: stored.id,
      });
      expect(result).not.toBeNull();
      if (!result || !("stream" in result)) {
        throw new Error("expected a stream result");
      }
      expect(result.row.storage_uri).toMatch(/^azure-blob:\/\//);

      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("azure media payload");
    });
  });
});
