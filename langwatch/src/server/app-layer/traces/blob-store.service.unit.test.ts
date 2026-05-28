import { describe, it, expect, vi } from "vitest";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BlobStore,
  BlobIntegrityError,
  UnauthorizedBlobAccessError,
  type S3ClientResolver,
} from "./blob-store.service";

/**
 * In-memory fake S3 keyed by `${bucket}/${key}`. Each project resolves to its
 * own org bucket, so the fake models cross-tenant isolation by bucket.
 */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const { Bucket, Key, Body } = command.input;
      objects.set(`${Bucket}/${Key}`, Body as Buffer);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const { Bucket, Key } = command.input;
      const stored = objects.get(`${Bucket}/${Key}`);
      if (!stored) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return {
        Body: { transformToString: async () => stored.toString("utf-8") },
      };
    }
    throw new Error("unexpected command");
  });
  return { objects, s3Client: { send } as never };
}

/** Resolver that gives each org its own bucket: project "<org>:<n>" → "<org>-bucket". */
function resolverFor(fake: ReturnType<typeof fakeS3>): S3ClientResolver {
  return async (projectId: string) => ({
    s3Client: fake.s3Client,
    s3Bucket: `${projectId.split(":")[0]}-bucket`,
  });
}

describe("BlobStore", () => {
  const coords = {
    projectId: "orgA:1",
    traceId: "trace-1",
    spanId: "span-1",
    attrKey: "langwatch.output",
  };

  describe("given a large field value", () => {
    describe("when put then get round-trips", () => {
      it("returns the exact original bytes", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const value = "héllo 🌍 " + "Z".repeat(100_000);

        const ref = await store.put({ ...coords, value });
        const got = await store.get({ projectId: coords.projectId, ref });

        expect(got).toBe(value);
      });

      it("records sha256 and utf-8 byte size on the ref", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const value = "abc";

        const ref = await store.put({ ...coords, value });

        // sha256("abc")
        expect(ref.sha256).toBe(
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(ref.size).toBe(3);
        expect(ref.encoding).toBe("utf-8");
      });
    });

    describe("when the stored bytes are tampered with", () => {
      it("throws BlobIntegrityError on get (sha mismatch)", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const ref = await store.put({ ...coords, value: "original" });
        // tamper with the stored object
        fake.objects.set(`orgA-bucket/${ref.key}`, Buffer.from("tampered"));

        await expect(
          store.get({ projectId: coords.projectId, ref }),
        ).rejects.toBeInstanceOf(BlobIntegrityError);
      });
    });
  });

  describe("given the positional key", () => {
    it("is project/trace/span/attr scoped under the trace-blobs prefix", () => {
      expect(BlobStore.blobKey(coords)).toBe(
        "trace-blobs/orgA:1/trace-1/span-1/langwatch.output",
      );
    });

    it("rejects path-traversal components", () => {
      expect(() =>
        BlobStore.blobKey({ ...coords, traceId: "../escape" }),
      ).toThrow(/path traversal/);
    });
  });

  describe("given two organizations with separate buckets", () => {
    describe("when org B tries to read a ref produced by org A", () => {
      it("cannot fetch it — throws UnauthorizedBlobAccessError before even reaching S3", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const ref = await store.put({ ...coords, value: "secret" }); // orgA:1 → orgA-bucket

        // CR-1: key-prefix check fires before resolveS3Client is called — error
        // is UnauthorizedBlobAccessError, not NoSuchKey from S3.
        await expect(
          store.get({ projectId: "orgB:9", ref }),
        ).rejects.toBeInstanceOf(UnauthorizedBlobAccessError);
      });
    });
  });

  describe("given a blob ref whose key belongs to a different project", () => {
    describe("when get is called with a mismatched projectId", () => {
      it("throws UnauthorizedBlobAccessError without calling the S3 client", async () => {
        // Capture the send spy before wrapping it as `never` inside fakeS3
        const sendSpy = vi.fn(async (_command: unknown) => ({}));
        const fakeWithSpy = {
          objects: new Map<string, Buffer>(),
          s3Client: { send: sendSpy } as never,
        };
        const store = new BlobStore(async (_projectId: string) => ({
          s3Client: fakeWithSpy.s3Client,
          s3Bucket: "any-bucket",
        }));

        // A ref that was created for orgA but presented with orgB's projectId
        const foreignRef = {
          key: "trace-blobs/orgA:1/trace-1/span-1/langwatch.output",
          size: 10,
          sha256: "abc",
          encoding: "utf-8" as const,
        };

        await expect(
          store.get({ projectId: "orgB:9", ref: foreignRef }),
        ).rejects.toBeInstanceOf(UnauthorizedBlobAccessError);

        // The S3 client must not have been called at all
        expect(sendSpy).not.toHaveBeenCalled();
      });
    });
  });
});
