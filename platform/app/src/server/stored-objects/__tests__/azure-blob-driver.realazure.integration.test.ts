/**
 * @vitest-environment node
 * @integration
 *
 * AC37 (issue #4133) — the SAME driver contract as
 * `azure-blob-driver.integration.test.ts`, but against a REAL Azure Storage
 * account instead of Azurite.
 *
 * Why this exists as a separate suite: Azurite is reachable only through
 * PATH-style addressing (`http://host:10000/{account}/...`), so every
 * signature the emulator suite verifies takes the `pathStyle: true` branch of
 * `canonicalisedResource`. Production Azure is HOST-style
 * (`https://{account}.blob.core.windows.net/...`) and takes the OTHER branch —
 * which no emulator test can ever exercise. A signing bug that only affects
 * production would pass the entire Azurite suite green.
 *
 * Skips itself unless the four env vars below are set, so CI (which has no
 * Azure credentials) is unaffected. To run it:
 *
 *   LANGWATCH_TEST_AZURE_ACCOUNT_NAME=... \
 *   LANGWATCH_TEST_AZURE_ACCOUNT_KEY=... \
 *   LANGWATCH_TEST_AZURE_CONTAINER=... \
 *   pnpm test:integration run src/server/stored-objects/__tests__/azure-blob-driver.realazure.integration.test.ts
 *
 * Every blob it writes is prefixed with a unique run id and deleted in
 * `afterAll`, so it never accumulates state in the account.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// env mock — the driver takes explicit credentials in this suite; the mock
// only exists so the real env.mjs does not fail validation under test.
vi.mock("~/env.mjs", () => ({
  env: { S3_BUCKET_NAME: "" },
}));

import { AzureBlobDriver } from "../azure-blob-driver";
import { ObjectNotFoundError } from "../errors";
import { StorageRegistry } from "../storage-registry";
import { mintAzureBlobUri } from "../uri";

const ACCOUNT_NAME = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_KEY;
const CONTAINER = process.env.LANGWATCH_TEST_AZURE_CONTAINER;
/** Optional — sovereign clouds / private endpoints. Public Azure needs none. */
const ENDPOINT = process.env.LANGWATCH_TEST_AZURE_ENDPOINT;

const hasRealAzure = Boolean(ACCOUNT_NAME && ACCOUNT_KEY && CONTAINER);
const describeRealAzure = hasRealAzure ? describe : describe.skip;

/**
 * Token-mode (Entra) verification against a real account. Separate switch from
 * the shared-key one above because it needs a DIFFERENT account posture —
 * ideally one with `allowSharedKeyAccess=false`, where the shared-key suite
 * cannot pass by construction.
 *
 * `azureCli` is the mode a developer can actually run: it borrows the identity
 * from `az login`. The AKS path (`workloadIdentity`) is the same code with a
 * different credential class, so exercising this proves the bearer request
 * shape Azure accepts — the thing no mocked test and no emulator can.
 */
const TOKEN_MODE_ACCOUNT = process.env.LANGWATCH_TEST_AZURE_TOKEN_ACCOUNT_NAME;
const hasTokenModeAzure = Boolean(TOKEN_MODE_ACCOUNT && CONTAINER);
const describeTokenAzure = hasTokenModeAzure ? describe : describe.skip;

/** Unique per run so parallel runs and leftovers never collide. */
const RUN_ID = crypto.randomBytes(6).toString("hex");
const PROJECT = `test-realazure-${RUN_ID}`;

let driver: AzureBlobDriver;
const writtenUris: string[] = [];

function uriFor(bytes: Buffer): string {
  const uri = mintAzureBlobUri({
    accountName: ACCOUNT_NAME!,
    container: CONTAINER!,
    projectId: PROJECT,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
  writtenUris.push(uri);
  return uri;
}

beforeAll(() => {
  if (!hasRealAzure) return;
  driver = new AzureBlobDriver({
    mode: "sharedKey",
    accountName: ACCOUNT_NAME!,
    accountKey: ACCOUNT_KEY!,
    // Undefined for public Azure — the driver then derives the host-style
    // endpoint, which is exactly the branch under test.
    endpointBaseUrl: ENDPOINT,
  });
});

afterAll(async () => {
  if (!hasRealAzure) return;
  await Promise.allSettled(writtenUris.map((uri) => driver.delete(uri)));
});

describeRealAzure(
  "AzureBlobDriver against real Azure Blob Storage (host-style addressing)",
  () => {
    describe("given a host-style production endpoint", () => {
      it("signs the request correctly for the single-account canonicalised resource form", async () => {
        const bytes = Buffer.from(`real-azure round-trip ${RUN_ID}`, "utf8");
        const uri = uriFor(bytes);

        // A signing regression on the host-style branch surfaces here as a 403
        // AuthorizationFailure — the Azurite suite cannot catch it.
        await driver.put(uri, bytes, "text/plain");
        expect(await driver.exists(uri)).toBe(true);

        const stream = await driver.get(uri);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes.toString("utf8"));
      });

      it("reports the blob size from a signed HEAD without transferring the body", async () => {
        const bytes = Buffer.from(`sized payload ${RUN_ID}`, "utf8");
        const uri = uriFor(bytes);

        await driver.put(uri, bytes, "application/octet-stream");

        expect(await driver.head(uri)).toBe(bytes.length);
      });
    });

    describe("given a zero-byte body", () => {
      /**
       * The P1 regression (empty-string Content-Length in the string-to-sign)
       * was only ever proven against Azurite. Real Azure enforces the same
       * shared-key rule, so this is the authoritative check.
       */
      it("stores and reads back an empty blob instead of failing authorization", async () => {
        const bytes = Buffer.alloc(0);
        const uri = uriFor(bytes);

        await driver.put(uri, bytes, "application/octet-stream");

        expect(await driver.exists(uri)).toBe(true);
        expect(await driver.head(uri)).toBe(0);

        // The name promises a read, so actually perform one: a signed GET of a
        // zero-length blob is its own case, not implied by exists() or head().
        const stream = await driver.get(uri);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks)).toHaveLength(0);
      });
    });

    describe("given a blob that was deleted", () => {
      it("reports it as absent and raises ObjectNotFoundError on read", async () => {
        const bytes = Buffer.from(`transient ${RUN_ID}`, "utf8");
        const uri = uriFor(bytes);

        await driver.put(uri, bytes, "text/plain");
        await driver.delete(uri);

        expect(await driver.exists(uri)).toBe(false);
        await expect(driver.get(uri)).rejects.toBeInstanceOf(ObjectNotFoundError);
      });
    });

    describe("when dispatched through the storage registry", () => {
      it("routes an azure-blob URI to the Azure driver on read", async () => {
        const bytes = Buffer.from(`registry dispatch ${RUN_ID}`, "utf8");
        const uri = uriFor(bytes);
        await driver.put(uri, bytes, "text/plain");

        const registry = new StorageRegistry({
          // s3/file are mandatory on the registry but unused here — any
          // StorageDriver satisfies the type; azure-blob does the real work.
          s3: driver,
          file: driver,
          "azure-blob": driver,
        });

        const stream = await registry.get(uri);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes.toString("utf8"));
      });
    });
  },
);

describeTokenAzure(
  "AzureBlobDriver against real Azure Blob using an Entra identity",
  () => {
    const tokenUris: string[] = [];

    function tokenDriver() {
      return new AzureBlobDriver({
        mode: "azureCli",
        accountName: TOKEN_MODE_ACCOUNT!,
      });
    }

    function tokenUriFor(bytes: Buffer): string {
      const uri = mintAzureBlobUri({
        accountName: TOKEN_MODE_ACCOUNT!,
        container: CONTAINER!,
        projectId: `test-token-${RUN_ID}`,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
      tokenUris.push(uri);
      return uri;
    }

    afterAll(async () => {
      if (!hasTokenModeAzure) return;
      await Promise.allSettled(tokenUris.map((uri) => tokenDriver().delete(uri)));
    });

    describe("given an account that refuses shared-key authentication", () => {
      /** @scenario "Blobs round-trip against a real storage account with shared-key access disabled" */
      it("writes, reads, sizes and deletes using a bearer token", async () => {
        const driver = tokenDriver();
        const bytes = Buffer.from(`entra round-trip ${RUN_ID}`, "utf8");
        const uri = tokenUriFor(bytes);

        await driver.put(uri, bytes, "text/plain");
        expect(await driver.exists(uri)).toBe(true);
        expect(await driver.head(uri)).toBe(bytes.length);

        const stream = await driver.get(uri);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes.toString("utf8"));

        await driver.delete(uri);
        expect(await driver.exists(uri)).toBe(false);
      }, 60_000);

      /** @scenario "Blobs round-trip against a real storage account with shared-key access disabled" */
      it("stores a zero-byte blob, the case that broke shared-key signing", async () => {
        const driver = tokenDriver();
        const bytes = Buffer.alloc(0);
        const uri = tokenUriFor(bytes);

        await driver.put(uri, bytes, "application/octet-stream");

        expect(await driver.exists(uri)).toBe(true);
        expect(await driver.head(uri)).toBe(0);
      }, 60_000);
    });
  },
);
