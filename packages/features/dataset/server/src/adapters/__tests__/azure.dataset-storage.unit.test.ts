import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDatasetStorageAdapter } from "../azure.dataset-storage.adapter";
import { CHUNK_MAX_BYTES } from "../../services/dataset-chunking";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
} from "../../services/errors";
import {
  DatasetAzureConfigResolver,
  type DatasetBlobDriver,
} from "../../ports/dataset-storage.port";

/**
 * Duck-typed by the adapter (`error.name === "ObjectNotFoundError"`, see
 * `isMissingObjectError`), mirroring `@langwatch/stored-object-server`'s
 * `ObjectNotFoundError` without taking a cross-package dependency for a test
 * double.
 */
class FakeObjectNotFoundError extends Error {
  constructor(uri: string) {
    super(`Object not found: ${uri}`);
    this.name = "ObjectNotFoundError";
  }
}

function toReadable(text: string): Readable {
  return Readable.from([Buffer.from(text, "utf-8")]);
}

const driverGet = vi.fn();
const driverPut = vi.fn();
const driverDelete = vi.fn();
const driverExists = vi.fn();
const driverHead = vi.fn();

function fakeDriver(): DatasetBlobDriver {
  return {
    get: driverGet,
    put: driverPut,
    delete: driverDelete,
    exists: driverExists,
    head: driverHead,
  };
}

class FixedAzureConfigResolver extends DatasetAzureConfigResolver {
  readonly resolve = vi.fn(async () => ({
    driver: fakeDriver(),
    accountName: "lwacct",
    container: "lw-container",
  }));
}

function makeStorage(): AzureDatasetStorageAdapter {
  return AzureDatasetStorageAdapter.create(new FixedAzureConfigResolver());
}

beforeEach(() => {
  driverGet.mockReset();
  driverPut.mockReset();
  driverDelete.mockReset();
  driverHead.mockReset();
  driverExists.mockReset();
});

/**
 * An in-memory stand-in for the Azure Blob byte-level transport. The
 * write→read round trip below originally ran against a real Azurite emulator
 * (`azure-dataset-storage.integration.test.ts`); that test-support helper was
 * retired with `platform/app`, so this exercises the same adapter contract
 * (`writeChunks` really produces the objects `readChunks` really parses) at
 * unit level instead of losing the coverage outright.
 */
function inMemoryDriver(): DatasetBlobDriver {
  const objects = new Map<string, Buffer>();
  return {
    put: vi.fn(async (uri: string, body: Buffer) => {
      objects.set(uri, body);
    }),
    get: vi.fn(async (uri: string) => {
      const body = objects.get(uri);
      if (!body) throw new FakeObjectNotFoundError(uri);
      return Readable.from([body]);
    }),
    head: vi.fn(async (uri: string) => {
      const body = objects.get(uri);
      if (!body) throw new FakeObjectNotFoundError(uri);
      return body.byteLength;
    }),
    exists: vi.fn(async (uri: string) => objects.has(uri)),
    delete: vi.fn(async (uri: string) => {
      objects.delete(uri);
    }),
  };
}

describe("AzureDatasetStorageAdapter", () => {
  describe("writeChunks() + readChunks()", () => {
    describe("given a dataset written to Azure Blob", () => {
      /** @scenario "Datasets round-trip through Azure Blob when azure is the configured backend" */
      /** @scenario "An Azure-only installation supports every shared object-storage workload" */
      it("reads the same rows back in order", async () => {
        class InMemoryAzureConfigResolver extends DatasetAzureConfigResolver {
          private readonly driver = inMemoryDriver();
          resolve = vi.fn(async () => ({
            driver: this.driver,
            accountName: "lwacct",
            container: "lw-container",
          }));
        }
        const storage = AzureDatasetStorageAdapter.create(new InMemoryAzureConfigResolver());
        const records = [{ a: 1 }, { a: 2 }, { a: 3 }];

        const chunks = await storage.writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records,
        });
        const rows = await storage.readChunks({
          projectId: "p1",
          datasetId: "d1",
          chunkCount: chunks.length,
        });

        expect(rows).toEqual(records);
      });
    });
  });

  describe("writeChunks()", () => {
    describe("when writing with a non-zero fromIndex (append)", () => {
      it("puts chunk objects whose azure-blob uri carries the offset zero-padded index", async () => {
        driverPut.mockResolvedValue(undefined);

        await makeStorage().writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
          fromIndex: 3,
        });

        expect(driverPut).toHaveBeenCalledTimes(1);
        const [uri] = driverPut.mock.calls[0]!;
        expect(uri).toBe("azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00003.jsonl");
      });
    });
  });

  describe("readChunks()", () => {
    describe("when every chunk resolves", () => {
      it("parses rows back in order across chunks", async () => {
        driverGet
          .mockResolvedValueOnce(toReadable('{"a":1}\n'))
          .mockResolvedValueOnce(toReadable('{"a":2}\n'));

        const rows = await makeStorage().readChunks({
          projectId: "p1",
          datasetId: "d1",
          chunkCount: 2,
        });

        expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
      });
    });

    describe("when a chunk the count claims to exist is missing", () => {
      /** @scenario "Datasets round-trip through Azure Blob when azure is the configured backend" */
      it("throws MissingChunkError instead of silently truncating", async () => {
        driverGet.mockRejectedValueOnce(
          new FakeObjectNotFoundError(
            "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00000.jsonl",
          ),
        );

        await expect(
          makeStorage().readChunks({
            projectId: "p1",
            datasetId: "d1",
            chunkCount: 1,
          }),
        ).rejects.toBeInstanceOf(MissingChunkError);
      });
    });
  });

  describe("readChunk()", () => {
    it("returns the parsed rows for a single chunk", async () => {
      driverGet.mockResolvedValueOnce(toReadable('{"a":1}\n{"a":2}\n'));

      const rows = await makeStorage().readChunk({
        projectId: "p1",
        datasetId: "d1",
        index: 0,
      });

      expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    });
  });

  describe("rewriteChunk()", () => {
    describe("when the rewritten records fit under the cap", () => {
      it("overwrites the chunk object and returns chunk-local offsets", async () => {
        driverPut.mockResolvedValue(undefined);

        const offset = await makeStorage().rewriteChunk({
          projectId: "p1",
          datasetId: "d1",
          index: 2,
          records: [{ a: 1 }, { a: 2 }],
        });

        expect(offset).toEqual({
          index: 2,
          startRow: 0,
          endRow: 2,
          byteSize: expect.any(Number),
        });
        const [uri] = driverPut.mock.calls[0]!;
        expect(uri).toBe("azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00002.jsonl");
      });
    });

    describe("when the rewritten records exceed the chunk cap", () => {
      it("rejects with ChunkTooLargeError instead of writing an oversized object", async () => {
        const oversized = [{ blob: "x".repeat(CHUNK_MAX_BYTES + 1) }];

        await expect(
          makeStorage().rewriteChunk({
            projectId: "p1",
            datasetId: "d1",
            index: 0,
            records: oversized,
          }),
        ).rejects.toBeInstanceOf(ChunkTooLargeError);
        expect(driverPut).not.toHaveBeenCalled();
      });
    });
  });

  describe("deleteChunksFrom()", () => {
    it("deletes contiguous chunks starting at fromIndex and stops at the first gap", async () => {
      driverExists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      driverDelete.mockResolvedValue(undefined);

      await makeStorage().deleteChunksFrom({
        projectId: "p1",
        datasetId: "d1",
        fromIndex: 1,
      });

      expect(driverDelete).toHaveBeenCalledTimes(2);
      expect(driverDelete.mock.calls[0]![0]).toBe(
        "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00001.jsonl",
      );
      expect(driverDelete.mock.calls[1]![0]).toBe(
        "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00002.jsonl",
      );
    });
  });

  describe("createPresignedUpload()", () => {
    it("mints a same-origin staging URL like the local backend, not a cross-origin presign", async () => {
      const upload = await makeStorage().createPresignedUpload({ projectId: "p1" });

      expect(upload.key).toMatch(/^staging\/p1\//);
      expect(upload.url).toMatch(/^\/api\/dataset\/direct-upload\/staging\//);
    });
  });

  describe("putStaged() / streamStaged() / headStagedObjectSize() / deleteStaged()", () => {
    describe("when depositing then reading back a staged upload", () => {
      it("round-trips the bytes through the driver", async () => {
        driverPut.mockResolvedValue(undefined);
        const storage = makeStorage();
        const key = "staging/p1/upload-1";

        await storage.putStaged({
          projectId: "p1",
          key,
          body: toReadable("hello"),
        });

        expect(driverPut).toHaveBeenCalledTimes(1);
        const [uri, bytes] = driverPut.mock.calls[0]!;
        expect(uri).toBe(`azure-blob://lwacct/lw-container/${key}`);
        expect(Buffer.from(bytes as Buffer).toString("utf-8")).toBe("hello");
      });
    });

    describe("when the staged object does not exist", () => {
      /** @scenario "Datasets round-trip through Azure Blob when azure is the configured backend" */
      it("streamStaged throws StagedUploadNotFoundError", async () => {
        driverGet.mockRejectedValueOnce(
          new FakeObjectNotFoundError("azure-blob://lwacct/lw-container/staging/p1/missing"),
        );

        await expect(
          makeStorage().streamStaged({
            projectId: "p1",
            key: "staging/p1/missing",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });

      it("headStagedObjectSize throws StagedUploadNotFoundError", async () => {
        driverHead.mockRejectedValueOnce(
          new FakeObjectNotFoundError("azure-blob://lwacct/lw-container/staging/p1/missing"),
        );

        await expect(
          makeStorage().headStagedObjectSize({
            projectId: "p1",
            key: "staging/p1/missing",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });
    });

    describe("when deleting a staged object", () => {
      it("delegates to the driver", async () => {
        driverDelete.mockResolvedValue(undefined);

        await makeStorage().deleteStaged({
          projectId: "p1",
          key: "staging/p1/upload-1",
        });

        expect(driverDelete).toHaveBeenCalledWith(
          "azure-blob://lwacct/lw-container/staging/p1/upload-1",
        );
      });
    });
  });
});
