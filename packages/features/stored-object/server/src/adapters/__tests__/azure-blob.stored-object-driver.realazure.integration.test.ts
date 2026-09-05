/**
 * @integration
 * @vitest-environment node
 */
import crypto from "node:crypto";
import { mintAzureBlobStoredObjectUri } from "@langwatch/stored-object-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AzureBlobStoredObjectDriverAdapter } from "../azure-blob.stored-object-driver.adapter";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import { StoredObjectStorageRegistry } from "../stored-object-storage-registry.adapter";

const ACCOUNT_NAME = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.LANGWATCH_TEST_AZURE_ACCOUNT_KEY;
const CONTAINER = process.env.LANGWATCH_TEST_AZURE_CONTAINER;
/** Optional — sovereign clouds / private endpoints. Public Azure needs none. */
const ENDPOINT = process.env.LANGWATCH_TEST_AZURE_ENDPOINT;

const hasRealAzure = Boolean(ACCOUNT_NAME && ACCOUNT_KEY && CONTAINER);
const describeRealAzure = hasRealAzure ? describe : describe.skip;

/**
 * Token-mode (Entra) verification against a real account. Separate switch from the
 * shared-key one above because it needs a DIFFERENT account posture — ideally one with
 * `allowSharedKeyAccess=false`, where the shared-key suite cannot pass by construction.
 */
const TOKEN_MODE_ACCOUNT = process.env.LANGWATCH_TEST_AZURE_TOKEN_ACCOUNT_NAME;
const hasTokenModeAzure = Boolean(TOKEN_MODE_ACCOUNT && CONTAINER);
const describeTokenAzure = hasTokenModeAzure ? describe : describe.skip;

/** Unique per run so parallel runs and leftovers never collide. */
const RUN_ID = crypto.randomBytes(6).toString("hex");
const PROJECT = `test-realazure-${RUN_ID}`;

let driver: AzureBlobStoredObjectDriverAdapter;
const writtenUris: string[] = [];
const tokenUris: string[] = [];

function uriFor(bytes: Buffer): string {
  const uri = mintAzureBlobStoredObjectUri({
    accountName: ACCOUNT_NAME!,
    container: CONTAINER!,
    projectId: PROJECT,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
  writtenUris.push(uri);
  return uri;
}

function tokenDriver() {
  return AzureBlobStoredObjectDriverAdapter.create({
    mode: "azureCli",
    accountName: TOKEN_MODE_ACCOUNT!,
    identity: {},
  });
}

function tokenUriFor(bytes: Buffer): string {
  const uri = mintAzureBlobStoredObjectUri({
    accountName: TOKEN_MODE_ACCOUNT!,
    container: CONTAINER!,
    projectId: `test-token-${RUN_ID}`,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
  tokenUris.push(uri);
  return uri;
}

beforeAll(() => {
  if (!hasRealAzure) return;
  driver = AzureBlobStoredObjectDriverAdapter.create({
    mode: "sharedKey",
    accountName: ACCOUNT_NAME!,
    accountKey: ACCOUNT_KEY!,
    // Undefined for public Azure — the driver then derives the host-style
    // endpoint, which is exactly the branch under test.
    endpointBaseUrl: ENDPOINT,
  });
});

afterAll(async () => {
  if (hasRealAzure) {
    await Promise.allSettled(writtenUris.map((uri) => driver.delete(uri)));
  }
  if (hasTokenModeAzure) {
    await Promise.allSettled(tokenUris.map((uri) => tokenDriver().delete(uri)));
  }
});

describeRealAzure(
  "AzureBlobStoredObjectDriverAdapter against real Azure Blob Storage (host-style addressing)",
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

        // The name promises a read, so actually perform one: a signed GET of a
        // zero-length blob is its own case, not implied by exists().
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

        const registry = new StoredObjectStorageRegistry({
          // s3/file are mandatory on the registry but unused here — any
          // StoredObjectStorageDriver satisfies the type; azure-blob does the
          // real work.
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
  "AzureBlobStoredObjectDriverAdapter against real Azure Blob using an Entra identity",
  () => {
    describe("given an account that refuses shared-key authentication", () => {
      /** @scenario "Blobs round-trip against a real storage account with shared-key access disabled" */
      it("writes, reads, sizes and deletes using a bearer token", async () => {
        const tokenDriverInstance = tokenDriver();
        const bytes = Buffer.from(`entra round-trip ${RUN_ID}`, "utf8");
        const uri = tokenUriFor(bytes);

        await tokenDriverInstance.put(uri, bytes, "text/plain");
        expect(await tokenDriverInstance.exists(uri)).toBe(true);

        const stream = await tokenDriverInstance.get(uri);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes.toString("utf8"));

        await tokenDriverInstance.delete(uri);
        expect(await tokenDriverInstance.exists(uri)).toBe(false);
      }, 60_000);

      /** @scenario "Blobs round-trip against a real storage account with shared-key access disabled" */
      it("stores a zero-byte blob, the case that broke shared-key signing", async () => {
        const tokenDriverInstance = tokenDriver();
        const bytes = Buffer.alloc(0);
        const uri = tokenUriFor(bytes);

        await tokenDriverInstance.put(uri, bytes, "application/octet-stream");

        expect(await tokenDriverInstance.exists(uri)).toBe(true);
      }, 60_000);
    });
  },
);
