/**
 * @vitest-environment node
 * @integration
 *
 * langwatch/langwatch-saas#800 — the trace spool against a REAL Azure Blob
 * account, not the emulator.
 *
 * Why this exists alongside `trace-spool-azure.integration.test.ts`: Azurite is
 * path-style only (`host/account/container/blob`), production Azure is
 * host-style (`account.blob.core.windows.net/container/blob`). The two
 * canonicalise differently in the SharedKey string-to-sign, so a signature bug
 * on the host-style path produces a well-formed header that only real Azure
 * rejects — with a 403 the emulator can never produce. #6181 was bitten by
 * exactly that. The spool mints a deeper object path than any other caller
 * (`trace-blobs/spool/{project}/{trace}/{span}`), which is the shape where such
 * a bug hides.
 *
 * Self-skips without credentials, like the sibling driver suite, so CI stays
 * green and a developer with an account gets the coverage:
 *
 *   LANGWATCH_TEST_AZURE_ACCOUNT_NAME
 *   LANGWATCH_TEST_AZURE_ACCOUNT_KEY
 *   LANGWATCH_TEST_AZURE_CONTAINER
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  BlobStore,
  type S3ClientResolver,
  SpoolDestinationUnsupportedError,
  type SpoolStorage,
} from "~/server/app-layer/traces/blob-store.service";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";

const ACCOUNT_NAME = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_KEY;
const CONTAINER = process.env.LANGWATCH_TEST_AZURE_CONTAINER;

const hasRealAzure = Boolean(ACCOUNT_NAME && ACCOUNT_KEY && CONTAINER);
const describeRealAzure = hasRealAzure ? describe : describe.skip;

const RUN_ID = `${Date.now()}`;
const PROJECT_ID = `proj-spool-${RUN_ID}`;

function driver(): AzureBlobDriver {
  return new AzureBlobDriver({
    accountName: ACCOUNT_NAME!,
    accountKey: ACCOUNT_KEY!,
  });
}

const AZURE_DESTINATION: ProjectStorageDestination = {
  kind: "azure",
  accountName: ACCOUNT_NAME!,
  container: CONTAINER!,
};

/** Fails the test if the spool reaches for S3 on an Azure-configured project. */
const s3MustNotBeUsed: S3ClientResolver = async () => {
  throw new Error("the spool reached for an S3 client on an Azure deployment");
};

function azureSpoolStorage(): SpoolStorage {
  return {
    objectStoreFor: () => driver(),
    resolveDestination: async () => AZURE_DESTINATION,
  };
}

function spoolStore(): BlobStore {
  return new BlobStore({
    resolveS3Client: s3MustNotBeUsed,
    spoolStorage: azureSpoolStorage(),
  });
}

function uriFor(traceId: string, spanId: string): string {
  return `azure-blob://${ACCOUNT_NAME}/${CONTAINER}/trace-blobs/spool/${PROJECT_ID}/${traceId}/${spanId}`;
}

const created: string[] = [];

afterAll(async () => {
  if (!hasRealAzure) return;
  // Belt and braces: the tests delete what they write, this catches a failure
  // that left something behind.
  await Promise.allSettled(created.map((uri) => driver().delete(uri)));
});

describeRealAzure("trace spool against real Azure Blob Storage", () => {
  describe("given an over-threshold span on an Azure-configured project", () => {
    it("round-trips the payload host-style and cleans the object up", async () => {
      const store = spoolStore();
      const traceId = `trace-${RUN_ID}`;
      const spanId = `span-${RUN_ID}`;
      // Larger than COMMAND_INLINE_THRESHOLD, which is what puts a span here.
      const body = Buffer.from("x".repeat(300 * 1024), "utf-8");
      const uri = uriFor(traceId, spanId);
      created.push(uri);

      const spoolRef = await store.putSpool({
        projectId: PROJECT_ID,
        traceId,
        spanId,
        body,
      });

      // Present in the real account, at the exact path the lifecycle rule
      // is documented to match.
      expect(await driver().exists(uri)).toBe(true);
      expect(await driver().head(uri)).toBe(body.length);

      const retrieved = await store.getSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId,
        spanId,
      });
      expect(retrieved).toEqual(body);

      await store.deleteSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId,
        spanId,
      });
      expect(await driver().exists(uri)).toBe(false);
    }, 120_000);

    it("never reaches for S3 while a legacy S3 bucket is still configured", async () => {
      const legacyS3 = vi.fn();
      const store = new BlobStore({
        resolveS3Client: async () => ({
          s3Client: { send: legacyS3 } as never,
          s3Bucket: "legacy-bucket",
        }),
        spoolStorage: azureSpoolStorage(),
      });
      const traceId = `trace-legacy-${RUN_ID}`;
      const spanId = `span-legacy-${RUN_ID}`;
      const uri = uriFor(traceId, spanId);
      created.push(uri);

      const spoolRef = await store.putSpool({
        projectId: PROJECT_ID,
        traceId,
        spanId,
        body: Buffer.from("y".repeat(300 * 1024), "utf-8"),
      });

      expect(legacyS3).not.toHaveBeenCalled();
      expect(await driver().exists(uri)).toBe(true);

      await store.deleteSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId,
        spanId,
      });
    }, 120_000);
  });

  describe("given a span id that tries to escape the spool prefix", () => {
    it("confines it to one path component in the real account", async () => {
      const store = spoolStore();
      const traceId = "../../../../../../etc/evil";
      const spanId = `span-escape-${RUN_ID}`;
      const body = Buffer.from("z".repeat(300 * 1024), "utf-8");

      const spoolRef = await store.putSpool({
        projectId: PROJECT_ID,
        traceId,
        spanId,
        body,
      });

      // Reads back through the same derivation, so the object is addressable.
      expect(
        await store.getSpool({
          spoolRef,
          projectId: PROJECT_ID,
          traceId,
          spanId,
        }),
      ).toEqual(body);

      await store.deleteSpool({
        spoolRef,
        projectId: PROJECT_ID,
        traceId,
        spanId,
      });
    }, 120_000);
  });

  describe("given a project whose storage is the local filesystem", () => {
    it("refuses the spool rather than writing an object nothing reaps", async () => {
      const store = new BlobStore({
        resolveS3Client: s3MustNotBeUsed,
        spoolStorage: {
          objectStoreFor: () => driver(),
          resolveDestination: async () => ({
            kind: "file",
            root: "/var/lib/langwatch/objects",
          }),
        },
      });

      await expect(
        store.putSpool({
          projectId: PROJECT_ID,
          traceId: `trace-local-${RUN_ID}`,
          spanId: `span-local-${RUN_ID}`,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toBeInstanceOf(SpoolDestinationUnsupportedError);
    }, 60_000);
  });
});
