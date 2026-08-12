/**
 * @vitest-environment node
 * @integration
 *
 * langwatch/langwatch-saas#800 — the ADR-022 trace spool honours the
 * deployment's storage destination instead of assuming AWS S3.
 *
 * Exercises the real signing + wire path against a live Azurite emulator
 * (testcontainers), not a fake object store: the unit suite proves the spool
 * asks for the right URI, but only a real emulator proves the bytes actually
 * land, come back identical, and delete. Before this change the same test
 * could not be written at all — the spool had no way to reach Azure.
 *
 * The three assertions here are the inversions of the two reproduce steps on
 * the issue:
 *   1. an azure-only deployment spools successfully (repro A wrote nothing)
 *   2. an azure deployment with a legacy S3 bucket still present writes to
 *      Azure and leaves S3 untouched (repro B wrote to the wrong cloud)
 *   3. the round-trip returns byte-identical content and cleans up after itself
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BlobStore,
  type S3ClientResolver,
  type SpoolStorage,
} from "~/server/app-layer/traces/blob-store.service";
import {
  ensureAzuriteContainer,
  type StartedAzurite,
  startAzurite,
  stopAzurite,
} from "~/server/stored-objects/__tests__/azurite-test-support";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";

const CONTAINER = "trace-spool";
const PROJECT_ID = "proj-spool-azure";
const TRACE_ID = "trace-abc";
const SPAN_ID = "span-def";

let azurite: StartedAzurite;
let driver: AzureBlobDriver;

/**
 * An S3 resolver that fails the test if the spool reaches for it. This is the
 * regression guard: the bug was that every spool write went here regardless of
 * how the deployment was configured.
 */
const s3MustNotBeUsed: S3ClientResolver = async () => {
  throw new Error(
    "the spool reached for an S3 client on an Azure-configured deployment",
  );
};

function azureSpoolStorage(): SpoolStorage {
  const destination: ProjectStorageDestination = {
    kind: "azure",
    accountName: azurite.accountName,
    container: CONTAINER,
  };
  return {
    objectStoreFor: () => driver,
    resolveDestination: async () => destination,
    // This suite proves the write path, so it runs as a deployment that has
    // provisioned the orphan-reaping lifecycle rule.
    azureRetentionConfirmed: true,
  };
}

beforeAll(async () => {
  azurite = await startAzurite();
  driver = new AzureBlobDriver({
    mode: "sharedKey",
    accountName: azurite.accountName,
    accountKey: azurite.accountKey,
    endpointBaseUrl: azurite.endpointBaseUrl,
  });
  await ensureAzuriteContainer({ azurite, container: CONTAINER });
}, 120_000);

afterAll(async () => {
  await stopAzurite(azurite);
});

describe("given a deployment whose storage destination is Azure Blob", () => {
  describe("when an over-threshold span is spooled at the ingestion edge", () => {
    it("round-trips the payload through Azure and cleans the object up", async () => {
      const store = new BlobStore({
        resolveS3Client: s3MustNotBeUsed,
        spoolStorage: azureSpoolStorage(),
      });
      // Larger than COMMAND_INLINE_THRESHOLD, which is what puts a span on this
      // path in the first place.
      const body = Buffer.from("x".repeat(300 * 1024), "utf-8");

      const spoolRef = await store.putSpool({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        body,
      });

      const uri = `azure-blob://${azurite.accountName}/${CONTAINER}/trace-blobs/spool/${PROJECT_ID}/${TRACE_ID}/${SPAN_ID}`;
      expect(await driver.exists(uri)).toBe(true);

      const retrieved = await store.getSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      });
      expect(retrieved).toEqual(body);

      await store.deleteSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      });
      expect(await driver.exists(uri)).toBe(false);
    }, 60_000);

    it("never reaches for S3, even while a legacy S3 bucket is still configured", async () => {
      // The documented mid-migration state: STORED_OBJECTS_BACKEND=azure with
      // S3_BUCKET_NAME still set so legacy objects stay readable. The spool used
      // to resolve that bucket and quietly keep writing trace payloads to AWS.
      const legacyS3 = vi.fn();
      const store = new BlobStore({
        resolveS3Client: async () => ({
          s3Client: { send: legacyS3 } as never,
          s3Bucket: "legacy-bucket",
        }),
        spoolStorage: azureSpoolStorage(),
      });

      const spoolRef = await store.putSpool({
        projectId: PROJECT_ID,
        traceId: "trace-legacy",
        spanId: "span-legacy",
        body: Buffer.from("y".repeat(300 * 1024), "utf-8"),
      });

      expect(legacyS3).not.toHaveBeenCalled();
      expect(
        await driver.exists(
          `azure-blob://${azurite.accountName}/${CONTAINER}/trace-blobs/spool/${PROJECT_ID}/trace-legacy/span-legacy`,
        ),
      ).toBe(true);

      await store.deleteSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId: "trace-legacy",
        spanId: "span-legacy",
      });
    }, 60_000);
  });
});
