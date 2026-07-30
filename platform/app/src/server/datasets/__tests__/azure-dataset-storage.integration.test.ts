/**
 * @vitest-environment node
 * @integration
 *
 * AC37 (issue #4133) — "Datasets round-trip through Azure Blob when azure is
 * the configured backend".
 *
 * Real-Azurite integration: exercises `AzureDatasetStorage` against a live
 * Azurite emulator (testcontainers), not a mocked driver. Mirrors
 * `local-dataset-storage.integration.test.ts`'s "real backend, no env mock"
 * approach — the implementation takes its wiring as constructor-adjacent
 * config (here: env vars for the account key/endpoint, since the class reads
 * the account/container from the resolver in production); this test stubs
 * only the resolver boundary and points AZURE_BLOB_* at the running Azurite
 * container.
 *
 * `.integration.test.ts` runs in CI under testcontainers; locally without
 * Docker the integration runner won't start — that's expected.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));
vi.mock("~/env.mjs", () => ({ env: mockEnv }));

const resolveProjectStorageDestination = vi.fn();
vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: (projectId: string) =>
    resolveProjectStorageDestination(projectId),
}));

import { nanoid } from "nanoid";
import {
  ensureAzuriteContainer,
  type StartedAzurite,
  startAzurite,
  stopAzurite,
} from "../../stored-objects/__tests__/azurite-test-support";
import { AzureDatasetStorage } from "../azure-dataset-storage";

const CONTAINER = "datasets";

let azurite: StartedAzurite;
let storage: AzureDatasetStorage;

beforeAll(async () => {
  azurite = await startAzurite();
  await ensureAzuriteContainer({ azurite, container: CONTAINER });

  // The full shared-key set: AzureDatasetStorage now resolves credentials
  // through the one shared resolver (#6087), which validates the account and
  // container alongside the key rather than trusting each caller to.
  mockEnv.STORED_OBJECTS_BACKEND = "azure";
  mockEnv.AZURE_BLOB_AUTH_MODE = "sharedKey";
  mockEnv.AZURE_BLOB_ACCOUNT_NAME = azurite.accountName;
  mockEnv.AZURE_BLOB_ACCOUNT_KEY = azurite.accountKey;
  mockEnv.AZURE_BLOB_CONTAINER = CONTAINER;
  mockEnv.AZURE_BLOB_ENDPOINT = azurite.endpointBaseUrl;
}, 60_000);

afterAll(async () => {
  await stopAzurite(azurite);
}, 30_000);

beforeEach(() => {
  resolveProjectStorageDestination.mockReset();
  resolveProjectStorageDestination.mockResolvedValue({
    kind: "azure",
    accountName: azurite.accountName,
    container: CONTAINER,
  });
  storage = new AzureDatasetStorage();
});

describe("AzureDatasetStorage against a real Azurite emulator", () => {
  describe("writeChunks() + readChunks()", () => {
    describe("given a dataset written to Azure Blob", () => {
      /** @scenario "Datasets round-trip through Azure Blob when azure is the configured backend" */
      /** @scenario "An Azure-only installation supports every shared object-storage workload" */
      it("reads the same rows back in order", async () => {
        const projectId = `p-${nanoid(6)}`;
        const datasetId = `d-${nanoid(6)}`;
        const records = [{ a: 1 }, { a: 2 }, { a: 3 }];

        const chunks = await storage.writeChunks({
          projectId,
          datasetId,
          records,
        });
        const rows = await storage.readChunks({
          projectId,
          datasetId,
          chunkCount: chunks.length,
        });

        expect(rows).toEqual(records);
      });
    });

    describe("given an appended dataset (non-zero fromIndex)", () => {
      it("reads all chunks back across the append boundary", async () => {
        const projectId = `p-${nanoid(6)}`;
        const datasetId = `d-${nanoid(6)}`;

        const first = await storage.writeChunks({
          projectId,
          datasetId,
          records: [{ a: 1 }],
        });
        const second = await storage.writeChunks({
          projectId,
          datasetId,
          records: [{ a: 2 }],
          fromIndex: first.length,
        });

        const rows = await storage.readChunks({
          projectId,
          datasetId,
          chunkCount: first.length + second.length,
        });

        expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
      });
    });
  });

  describe("rewriteChunk()", () => {
    describe("when a chunk is rewritten in place", () => {
      it("returns the replacement rows on the next read", async () => {
        const projectId = `p-${nanoid(6)}`;
        const datasetId = `d-${nanoid(6)}`;
        await storage.writeChunks({
          projectId,
          datasetId,
          records: [{ a: 1 }],
        });

        await storage.rewriteChunk({
          projectId,
          datasetId,
          index: 0,
          records: [{ a: 99 }],
        });

        const rows = await storage.readChunk({
          projectId,
          datasetId,
          index: 0,
        });
        expect(rows).toEqual([{ a: 99 }]);
      });
    });
  });

  describe("deleteChunksFrom()", () => {
    describe("when deleting from a non-zero index", () => {
      it("removes the tail and leaves earlier chunks readable", async () => {
        const projectId = `p-${nanoid(6)}`;
        const datasetId = `d-${nanoid(6)}`;
        await storage.writeChunks({
          projectId,
          datasetId,
          records: [{ a: 1 }],
        });
        await storage.writeChunks({
          projectId,
          datasetId,
          records: [{ a: 2 }],
          fromIndex: 1,
        });

        await storage.deleteChunksFrom({ projectId, datasetId, fromIndex: 1 });

        await expect(
          storage.readChunk({ projectId, datasetId, index: 1 }),
        ).rejects.toThrow();
        // Chunk 0 still readable — only the tail was deleted.
        const rows = await storage.readChunk({
          projectId,
          datasetId,
          index: 0,
        });
        expect(rows).toEqual([{ a: 1 }]);
      });
    });
  });

  describe("putStaged() / streamStaged() / headStagedObjectSize()", () => {
    describe("when a staged upload is deposited server-side", () => {
      it("round-trips the bytes and reports the size before deletion", async () => {
        const { Readable } = await import("node:stream");
        const projectId = `p-${nanoid(6)}`;
        const key = `staging/${projectId}/${nanoid(6)}`;

        await storage.putStaged({
          projectId,
          key,
          body: Readable.from([Buffer.from("staged bytes", "utf-8")]),
        });

        const size = await storage.headStagedObjectSize({ projectId, key });
        expect(size).toBe(Buffer.byteLength("staged bytes"));

        const stream = await storage.streamStaged({ projectId, key });
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).toString("utf-8")).toBe("staged bytes");

        await storage.deleteStaged({ projectId, key });
        await expect(
          storage.streamStaged({ projectId, key }),
        ).rejects.toThrow();
      });
    });
  });
});
