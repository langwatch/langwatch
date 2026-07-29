import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ONLY the boundaries: env + the resolver (which account/container to
// use) + the AzureBlobDriver's byte-level get/put/delete/exists. The chunk
// key math + JSONL (de)serialization under test stay real, so these
// assertions verify our wiring, not AzureBlobDriver internals.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));
vi.mock("~/env.mjs", () => ({ env: mockEnv }));

const resolveProjectStorageDestination = vi.fn();
vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: (projectId: string) =>
    resolveProjectStorageDestination(projectId),
}));

const driverGet = vi.fn();
const driverPut = vi.fn();
const driverDelete = vi.fn();
const driverExists = vi.fn();
const driverHead = vi.fn();
const driverConstructorCalls: unknown[] = [];
vi.mock("~/server/stored-objects/azure-blob-driver", () => ({
  AzureBlobDriver: class {
    constructor(config: unknown) {
      driverConstructorCalls.push(config);
    }
    get = driverGet;
    put = driverPut;
    delete = driverDelete;
    exists = driverExists;
    head = driverHead;
  },
}));

import { ObjectNotFoundError } from "~/server/stored-objects/errors";
import { AzureDatasetStorage } from "../azure-dataset-storage";
import { CHUNK_MAX_BYTES } from "../dataset-chunking";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
} from "../errors";

function toReadable(text: string): Readable {
  return Readable.from([Buffer.from(text, "utf-8")]);
}

beforeEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockEnv.AZURE_BLOB_ACCOUNT_KEY = "test-account-key";
  resolveProjectStorageDestination.mockReset();
  resolveProjectStorageDestination.mockResolvedValue({
    kind: "azure",
    accountName: "lwacct",
    container: "lw-container",
  });
  driverGet.mockReset();
  driverPut.mockReset();
  driverDelete.mockReset();
  driverHead.mockReset();
  driverExists.mockReset();
  driverConstructorCalls.length = 0;
});

describe("AzureDatasetStorage", () => {
  describe("writeChunks()", () => {
    describe("when writing with a non-zero fromIndex (append)", () => {
      it("puts chunk objects whose azure-blob uri carries the offset zero-padded index", async () => {
        driverPut.mockResolvedValue(undefined);

        await new AzureDatasetStorage().writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
          fromIndex: 3,
        });

        expect(driverPut).toHaveBeenCalledTimes(1);
        const [uri] = driverPut.mock.calls[0]!;
        expect(uri).toBe(
          "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00003.jsonl",
        );
      });
    });
  });

  describe("readChunks()", () => {
    describe("when every chunk resolves", () => {
      it("parses rows back in order across chunks", async () => {
        driverGet
          .mockResolvedValueOnce(toReadable('{"a":1}\n'))
          .mockResolvedValueOnce(toReadable('{"a":2}\n'));

        const rows = await new AzureDatasetStorage().readChunks({
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
          new ObjectNotFoundError(
            "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00000.jsonl",
          ),
        );

        await expect(
          new AzureDatasetStorage().readChunks({
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

      const rows = await new AzureDatasetStorage().readChunk({
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

        const offset = await new AzureDatasetStorage().rewriteChunk({
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
        expect(uri).toBe(
          "azure-blob://lwacct/lw-container/datasets/p1/d1/chunk-00002.jsonl",
        );
      });
    });

    describe("when the rewritten records exceed the chunk cap", () => {
      it("rejects with ChunkTooLargeError instead of writing an oversized object", async () => {
        const oversized = [{ blob: "x".repeat(CHUNK_MAX_BYTES + 1) }];

        await expect(
          new AzureDatasetStorage().rewriteChunk({
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

      await new AzureDatasetStorage().deleteChunksFrom({
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
      const upload = await new AzureDatasetStorage().createPresignedUpload({
        projectId: "p1",
      });

      expect(upload.key).toMatch(/^staging\/p1\//);
      expect(upload.url).toMatch(/^\/api\/dataset\/direct-upload\/staging\//);
    });
  });

  describe("putStaged() / streamStaged() / headStagedObjectSize() / deleteStaged()", () => {
    describe("when depositing then reading back a staged upload", () => {
      it("round-trips the bytes through the driver", async () => {
        driverPut.mockResolvedValue(undefined);
        const storage = new AzureDatasetStorage();
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
          new ObjectNotFoundError(
            "azure-blob://lwacct/lw-container/staging/p1/missing",
          ),
        );

        await expect(
          new AzureDatasetStorage().streamStaged({
            projectId: "p1",
            key: "staging/p1/missing",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });

      it("headStagedObjectSize throws StagedUploadNotFoundError", async () => {
        driverHead.mockRejectedValueOnce(
          new ObjectNotFoundError(
            "azure-blob://lwacct/lw-container/staging/p1/missing",
          ),
        );

        await expect(
          new AzureDatasetStorage().headStagedObjectSize({
            projectId: "p1",
            key: "staging/p1/missing",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });
    });

    describe("when deleting a staged object", () => {
      it("delegates to the driver", async () => {
        driverDelete.mockResolvedValue(undefined);

        await new AzureDatasetStorage().deleteStaged({
          projectId: "p1",
          key: "staging/p1/upload-1",
        });

        expect(driverDelete).toHaveBeenCalledWith(
          "azure-blob://lwacct/lw-container/staging/p1/upload-1",
        );
      });
    });
  });

  describe("given the resolver already validated the azure config", () => {
    it("constructs the driver from the resolver-guaranteed key without re-validating", async () => {
      // Single source of truth: resolveProjectStorageDestination throws
      // AzureBackendMisconfiguredError for any missing var BEFORE a
      // kind === "azure" destination can exist, so this class must not
      // carry a second validation site that drifts (PR #6092 review,
      // concern 5). The fail-loud contract itself is pinned by the
      // Scenario Outline in project-storage-destination.unit.test.ts.
      driverPut.mockResolvedValue(undefined);

      await new AzureDatasetStorage().writeChunks({
        projectId: "p1",
        datasetId: "d1",
        records: [{ a: 1 }],
      });

      expect(driverConstructorCalls.at(-1)).toMatchObject({
        accountName: "lwacct",
        accountKey: mockEnv.AZURE_BLOB_ACCOUNT_KEY,
      });
    });
  });

  describe("given the resolved destination is not azure", () => {
    it("throws rather than silently writing to the wrong backend", async () => {
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "s3",
        bucket: "some-bucket",
      });

      await expect(
        new AzureDatasetStorage().writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
        }),
      ).rejects.toThrow(/not azure/);
    });
  });
});
