import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ONLY the boundaries: the S3 client factory and the presigner. The
// command construction + key math + chunk (de)serialization under test stay
// real, so these assertions verify our wiring, not the AWS SDK.
const createS3Client = vi.fn();
vi.mock("../../storage", () => ({
  createS3Client: (projectId: string) => createS3Client(projectId),
}));

const getSignedUrl = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));

import { CHUNK_MAX_BYTES } from "../dataset-chunking";
import { ChunkTooLargeError, StagedUploadNotFoundError } from "../errors";
import { UPLOAD_TTL_SECONDS } from "../presigned-upload";
import { S3DatasetStorage } from "../s3-dataset-storage";

/** A fake resolved S3 client whose `send` is a controllable spy. */
const makeFakeClient = () => {
  const send = vi.fn();
  return { resolved: { s3Client: { send }, s3Bucket: "b" }, send };
};

beforeEach(() => {
  createS3Client.mockReset();
  getSignedUrl.mockReset();
});

describe("S3DatasetStorage", () => {
  describe("writeChunks()", () => {
    describe("when writing with a non-zero fromIndex (append)", () => {
      it("puts chunk objects whose keys carry the offset zero-padded index", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({});
        createS3Client.mockResolvedValue(resolved);

        await new S3DatasetStorage().writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
          fromIndex: 3,
        });

        const keys = send.mock.calls.map((call) => call[0].input.Key);
        expect(keys).toEqual(["datasets/p1/d1/chunk-00003.jsonl"]);
      });
    });
  });

  describe("readChunks()", () => {
    describe("when every chunk resolves", () => {
      it("parses rows back in order across chunks", async () => {
        const { resolved, send } = makeFakeClient();
        send
          .mockResolvedValueOnce({
            Body: { transformToString: () => Promise.resolve('{"a":1}\n') },
          })
          .mockResolvedValueOnce({
            Body: {
              transformToString: () => Promise.resolve('{"a":2}\n{"a":3}\n'),
            },
          });
        createS3Client.mockResolvedValue(resolved);

        const rows = await new S3DatasetStorage().readChunks({
          projectId: "p1",
          datasetId: "d1",
          chunkCount: 2,
        });

        expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      });
    });

    // @regression — a chunk that PG's chunkCount claims must exist is corruption,
    // not emptiness; the impl must throw rather than silently truncate the dataset.
    describe("when a chunk object is missing (NoSuchKey)", () => {
      it("throws the missing-chunk error instead of truncating", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockRejectedValue({ name: "NoSuchKey" });
        createS3Client.mockResolvedValue(resolved);

        await expect(
          new S3DatasetStorage().readChunks({
            projectId: "p1",
            datasetId: "d1",
            chunkCount: 1,
          }),
        ).rejects.toThrow(/Missing dataset chunk/);
      });
    });
  });

  describe("readChunk()", () => {
    describe("when the chunk resolves", () => {
      it("parses just that one chunk's rows", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({
          Body: {
            transformToString: () => Promise.resolve('{"a":1}\n{"a":2}\n'),
          },
        });
        createS3Client.mockResolvedValue(resolved);

        const rows = await new S3DatasetStorage().readChunk({
          projectId: "p1",
          datasetId: "d1",
          index: 2,
        });

        expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
        expect(send.mock.calls[0]![0].input.Key).toBe(
          "datasets/p1/d1/chunk-00002.jsonl",
        );
      });
    });

    // @regression — a single-chunk read must throw on a missing object, not
    // return empty, mirroring readChunks (corruption, not emptiness).
    describe("when the chunk object is missing (NoSuchKey)", () => {
      it("throws the missing-chunk error", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockRejectedValue({ name: "NoSuchKey" });
        createS3Client.mockResolvedValue(resolved);

        await expect(
          new S3DatasetStorage().readChunk({
            projectId: "p1",
            datasetId: "d1",
            index: 0,
          }),
        ).rejects.toThrow(/Missing dataset chunk/);
      });
    });
  });

  describe("rewriteChunk()", () => {
    describe("when overwriting a chunk in place", () => {
      it("puts exactly these rows to the right key and returns the new byteSize", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({});
        createS3Client.mockResolvedValue(resolved);

        const offset = await new S3DatasetStorage().rewriteChunk({
          projectId: "p1",
          datasetId: "d1",
          index: 3,
          records: [{ id: "r1", entry: { a: 1 } }],
        });

        expect(send).toHaveBeenCalledOnce();
        const put = send.mock.calls[0]![0];
        expect(put.constructor.name).toBe("PutObjectCommand");
        expect(put.input.Key).toBe("datasets/p1/d1/chunk-00003.jsonl");
        expect(put.input.Body).toBe('{"id":"r1","entry":{"a":1}}\n');
        expect(offset).toEqual({
          index: 3,
          startRow: 0,
          endRow: 1,
          byteSize: Buffer.byteLength('{"id":"r1","entry":{"a":1}}\n', "utf8"),
        });
      });
    });

    // P2#3 — an edit can replace a small row with a large value, growing the
    // chunk past CHUNK_MAX_BYTES. Reject rather than write an oversized object.
    describe("when the rewritten chunk would exceed CHUNK_MAX_BYTES", () => {
      it("throws ChunkTooLargeError and never PUTs the object", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({});
        createS3Client.mockResolvedValue(resolved);
        // One row whose serialized size is over the cap.
        const huge = "x".repeat(CHUNK_MAX_BYTES + 1024);

        await expect(
          new S3DatasetStorage().rewriteChunk({
            projectId: "p1",
            datasetId: "d1",
            index: 0,
            records: [{ id: "r1", entry: { a: huge } }],
          }),
        ).rejects.toBeInstanceOf(ChunkTooLargeError);
        expect(send).not.toHaveBeenCalled();
      });
    });
  });

  describe("deleteChunksFrom()", () => {
    // @regression — a re-drive that wrote fewer chunks than a crashed prior run
    // leaves orphan chunk objects; deleteChunksFrom must reap them from the new
    // chunk count upward and stop at the first gap, or readChunks corrupts on
    // the next read (I-IDEM).
    describe("when an orphan chunk remains past the new chunk count", () => {
      it("deletes the orphan and stops at the first missing index", async () => {
        const { resolved, send } = makeFakeClient();
        // HEAD chunk-00002 → exists; DeleteObject chunk-00002 → ok;
        // HEAD chunk-00003 → NoSuchKey (the first gap) → stop.
        send
          .mockResolvedValueOnce({ ContentLength: 10 }) // HEAD 2
          .mockResolvedValueOnce({}) // DELETE 2
          .mockRejectedValueOnce({ name: "NoSuchKey" }); // HEAD 3
        createS3Client.mockResolvedValue(resolved);

        await new S3DatasetStorage().deleteChunksFrom({
          projectId: "p1",
          datasetId: "d1",
          fromIndex: 2,
        });

        const commands = send.mock.calls.map((call) => ({
          name: call[0].constructor.name,
          key: call[0].input.Key,
        }));
        expect(commands).toEqual([
          {
            name: "HeadObjectCommand",
            key: "datasets/p1/d1/chunk-00002.jsonl",
          },
          {
            name: "DeleteObjectCommand",
            key: "datasets/p1/d1/chunk-00002.jsonl",
          },
          {
            name: "HeadObjectCommand",
            key: "datasets/p1/d1/chunk-00003.jsonl",
          },
        ]);
      });
    });

    describe("when no orphan chunks remain at the new count", () => {
      it("stops immediately without deleting anything", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockRejectedValueOnce({ name: "NotFound" }); // HEAD 2 → gap
        createS3Client.mockResolvedValue(resolved);

        await new S3DatasetStorage().deleteChunksFrom({
          projectId: "p1",
          datasetId: "d1",
          fromIndex: 2,
        });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]![0].constructor.name).toBe(
          "HeadObjectCommand",
        );
      });
    });
  });

  describe("createPresignedUpload()", () => {
    describe("when minting a presigned PUT", () => {
      it("targets a staging/{projectId}/ key and signs with the upload TTL", async () => {
        const { resolved } = makeFakeClient();
        createS3Client.mockResolvedValue(resolved);
        getSignedUrl.mockResolvedValue("https://signed");

        const result = await new S3DatasetStorage().createPresignedUpload({
          projectId: "p1",
        });

        expect(result.key).toMatch(/^staging\/p1\//);
        expect(result.url).toBe("https://signed");
        expect(getSignedUrl).toHaveBeenCalledWith(
          resolved.s3Client,
          expect.anything(),
          { expiresIn: UPLOAD_TTL_SECONDS },
        );
      });
    });
  });

  describe("headStagedObjectSize()", () => {
    describe("when the staged object exists", () => {
      it("returns its ContentLength", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({ ContentLength: 42 });
        createS3Client.mockResolvedValue(resolved);

        const size = await new S3DatasetStorage().headStagedObjectSize({
          projectId: "p1",
          key: "staging/p1/u1",
        });

        expect(size).toBe(42);
      });
    });

    describe("when the staged object does not exist (NoSuchKey)", () => {
      it("throws StagedUploadNotFoundError", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockRejectedValue({ name: "NoSuchKey" });
        createS3Client.mockResolvedValue(resolved);

        await expect(
          new S3DatasetStorage().headStagedObjectSize({
            projectId: "p1",
            key: "staging/p1/u1",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });
    });

    describe("when the HEAD reports no ContentLength", () => {
      it("throws StagedUploadNotFoundError instead of reporting 0 bytes", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({});
        createS3Client.mockResolvedValue(resolved);

        await expect(
          new S3DatasetStorage().headStagedObjectSize({
            projectId: "p1",
            key: "staging/p1/u1",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });
    });
  });

  describe("streamStaged()", () => {
    describe("when the staged object exists", () => {
      it("returns the GetObject body as a readable stream", async () => {
        const { resolved, send } = makeFakeClient();
        const body = Readable.from(['{"a":1}\n']);
        send.mockResolvedValue({ Body: body });
        createS3Client.mockResolvedValue(resolved);

        const stream = await new S3DatasetStorage().streamStaged({
          projectId: "p1",
          key: "staging/p1/u1",
        });

        const chunks: string[] = [];
        for await (const chunk of stream) chunks.push(String(chunk));
        expect(chunks.join("")).toBe('{"a":1}\n');
        expect(send.mock.calls[0]![0].input.Key).toBe("staging/p1/u1");
      });
    });

    describe("when the staged object does not exist (NoSuchKey)", () => {
      it("throws StagedUploadNotFoundError", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockRejectedValue({ name: "NoSuchKey" });
        createS3Client.mockResolvedValue(resolved);

        await expect(
          new S3DatasetStorage().streamStaged({
            projectId: "p1",
            key: "staging/p1/u1",
          }),
        ).rejects.toBeInstanceOf(StagedUploadNotFoundError);
      });
    });

    describe("when the key escapes the project's staging prefix", () => {
      it("rejects before touching S3", async () => {
        await expect(
          new S3DatasetStorage().streamStaged({
            projectId: "p1",
            key: "staging/p2/u1",
          }),
        ).rejects.toThrow(/traversal/);
      });
    });
  });

  describe("client memo", () => {
    describe("when two different projects resolve clients", () => {
      it("resolves a client per project", async () => {
        const a = makeFakeClient();
        const b = makeFakeClient();
        a.send.mockResolvedValue({});
        b.send.mockResolvedValue({});
        createS3Client
          .mockResolvedValueOnce(a.resolved)
          .mockResolvedValueOnce(b.resolved);

        const storage = new S3DatasetStorage();
        await storage.writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
        });
        await storage.writeChunks({
          projectId: "p2",
          datasetId: "d1",
          records: [{ a: 1 }],
        });

        expect(createS3Client).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the same project resolves a client twice", () => {
      it("reuses the memoized client", async () => {
        const { resolved, send } = makeFakeClient();
        send.mockResolvedValue({});
        createS3Client.mockResolvedValue(resolved);

        const storage = new S3DatasetStorage();
        await storage.writeChunks({
          projectId: "p1",
          datasetId: "d1",
          records: [{ a: 1 }],
        });
        await storage.writeChunks({
          projectId: "p1",
          datasetId: "d2",
          records: [{ a: 1 }],
        });

        expect(createS3Client).toHaveBeenCalledTimes(1);
      });
    });
  });
});
