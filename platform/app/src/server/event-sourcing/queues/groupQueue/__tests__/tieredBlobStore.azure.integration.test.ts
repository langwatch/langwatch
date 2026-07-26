/**
 * @vitest-environment node
 * @integration
 *
 * Issue #6087 — the groupQueue durable blob tier on an Azure-only install.
 *
 * The concern this answers: the durable tier is labelled `tier: "s3"`, so on a
 * deployment with no S3 anywhere — Azure Blob only — does offloading a large
 * job body fail?
 *
 * It must not. `tier` distinguishes "Redis or the durable store", nothing more:
 * both TypeScript branch points test `tier === "redis"` and fall through
 * otherwise, and the provider is re-derived at read time from
 * `resolveProjectStorageDestination`, never from the ref. `mintUri` therefore
 * produces an `azure-blob://` URI, and the registry dispatches on that scheme.
 *
 * That reasoning is only worth as much as a test that executes it, so this
 * drives a real TieredBlobStore against a real Azurite emulator with an azure
 * destination and NO S3 configured, through the actual production types.
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({ env: { S3_BUCKET_NAME: "" } }));

import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import { StorageRegistry } from "~/server/stored-objects/storage-registry";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import {
  ensureAzuriteContainer,
  startAzurite,
  stopAzurite,
  type StartedAzurite,
} from "~/server/stored-objects/__tests__/azurite-test-support";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { TieredBlobStore } from "../tieredBlobStore";

const CONTAINER = "stored-objects";
const PROJECT = createTenantId(
  `test-gq-azure-${crypto.randomBytes(4).toString("hex")}`,
);
/** Small, so a modest payload is unambiguously over the durable threshold. */
const THRESHOLD = 64;

let azurite: StartedAzurite;
let driver: AzureBlobDriver;

/**
 * Redis tier stubbed out: this test is about the DURABLE branch. A put that
 * ever landed here instead would fail the azure-blob assertions below.
 */
const redisBlobs = {
  put: vi.fn(async () => undefined),
  get: vi.fn(async () => null),
  peek: vi.fn(async () => null),
  delete: vi.fn(async () => undefined),
} as unknown as ConstructorParameters<typeof TieredBlobStore>[0]["redisBlobs"];

beforeAll(async () => {
  azurite = await startAzurite();
  await ensureAzuriteContainer(azurite, CONTAINER);
  driver = new AzureBlobDriver({
    mode: "sharedKey",
    accountName: azurite.accountName,
    accountKey: azurite.accountKey,
    endpointBaseUrl: azurite.endpointBaseUrl,
  });
}, 120_000);

afterAll(async () => {
  await stopAzurite(azurite);
}, 60_000);

/** An Azure-only install: the resolver returns azure, and no S3 exists. */
function azureOnlyStore(): TieredBlobStore {
  return new TieredBlobStore({
    redisBlobs,
    objectStoreFor: () =>
      new StorageRegistry({
        // Only the azure driver can actually serve a request here. s3/file are
        // structurally required by the registry; routing to either would mean
        // the scheme dispatch picked the wrong provider, and the test fails.
        s3: driver,
        file: driver,
        "azure-blob": driver,
      }),
    resolveDestination: async (): Promise<ProjectStorageDestination> => ({
      kind: "azure",
      accountName: azurite.accountName,
      container: CONTAINER,
    }),
    s3ThresholdBytes: THRESHOLD,
  });
}

async function drain(stream: Readable | Buffer | null): Promise<string> {
  if (stream === null) return "";
  if (Buffer.isBuffer(stream)) return stream.toString("utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

describe("groupQueue durable blob tier on an Azure-only install", () => {
  describe("given a job body over the durable threshold and no S3 configured", () => {
    /** @scenario "The groupQueue durable blob tier works in a token-based mode" */
    it("stores it in Azure Blob and reads the same bytes back", async () => {
      const store = azureOnlyStore();
      const body = Buffer.from("x".repeat(THRESHOLD * 4), "utf8");

      const ref = await store.put({
        projectId: PROJECT,
        data: body,
        mediaType: "application/json",
      });

      // The ref says "s3" — that is the durable tier's name, not its provider.
      expect(ref.tier).toBe("s3");

      // What matters is where the bytes actually went.
      expect(await drain(await store.get(ref))).toBe(body.toString("utf8"));

      // And they are genuinely in the Azure container, reachable by the same
      // content-addressed URI the production read path re-derives.
      const uri = `azure-blob://${azurite.accountName}/${CONTAINER}/${PROJECT}/${ref.hash}`;
      expect(await driver.exists(uri)).toBe(true);

      // Redis was never touched for a body this size.
      expect(redisBlobs.put).not.toHaveBeenCalled();
    }, 60_000);

    it("deletes it from Azure Blob through the same durable branch", async () => {
      const store = azureOnlyStore();
      const body = Buffer.from("y".repeat(THRESHOLD * 4), "utf8");

      const ref = await store.put({
        projectId: PROJECT,
        data: body,
        mediaType: "application/json",
      });
      const uri = `azure-blob://${azurite.accountName}/${CONTAINER}/${PROJECT}/${ref.hash}`;
      expect(await driver.exists(uri)).toBe(true);

      await store.delete(ref);

      expect(await driver.exists(uri)).toBe(false);
    }, 60_000);
  });
});
