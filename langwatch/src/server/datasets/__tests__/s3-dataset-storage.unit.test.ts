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

import { StagedUploadNotFoundError } from "../errors";
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
