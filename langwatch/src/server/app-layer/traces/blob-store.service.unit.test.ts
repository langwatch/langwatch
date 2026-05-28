import { describe, it, expect, vi } from "vitest";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BlobStore,
  BlobIntegrityError,
  BlobFieldNotFoundError,
  UnauthorizedBlobAccessError,
  type S3ClientResolver,
  type TraceBlobRef,
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

const coords = {
  projectId: "orgA:1",
  traceId: "trace-1",
  spanId: "span-1",
};

describe("BlobStore — manifest-shaped (one object per span)", () => {
  describe("given a span with multiple over-threshold fields", () => {
    describe("when put is called with all fields", () => {
      it("issues exactly ONE PutObjectCommand regardless of field count", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));

        await store.put({
          ...coords,
          fields: {
            "langwatch.input": "I".repeat(100_000),
            "langwatch.output": "O".repeat(100_000),
            "custom.context": "C".repeat(100_000),
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const putCalls = (fake.s3Client as any).send.mock.calls.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c: any) => c[0] instanceof PutObjectCommand,
        );
        expect(putCalls).toHaveLength(1);
      });

      it("returns one TraceBlobRef per field", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));

        const refs = await store.put({
          ...coords,
          fields: {
            "langwatch.input": "hello input",
            "langwatch.output": "hello output",
          },
        });

        expect(Object.keys(refs)).toEqual(
          expect.arrayContaining(["langwatch.input", "langwatch.output"]),
        );
        expect(refs["langwatch.input"]!.field).toBe("langwatch.input");
        expect(refs["langwatch.output"]!.field).toBe("langwatch.output");
      });

      it("each ref carries a per-field sha256 and byte size", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));

        const refs = await store.put({
          ...coords,
          fields: { "langwatch.output": "abc" },
        });

        const ref = refs["langwatch.output"]!;
        // sha256("abc")
        expect(ref.sha256).toBe(
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(ref.size).toBe(3);
        expect(ref.encoding).toBe("utf-8");
        // All refs for the same span share the span-level key (no attrKey in path)
        expect(ref.key).toBe("trace-blobs/orgA:1/trace-1/span-1");
      });
    });
  });

  describe("given a put followed by a get", () => {
    describe("when get is called for a specific field", () => {
      it("returns the exact original bytes for that field", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const inputValue = "héllo 🌍 " + "I".repeat(100_000);
        const outputValue = "héllo 🌍 " + "O".repeat(100_000);

        const refs = await store.put({
          ...coords,
          fields: {
            "langwatch.input": inputValue,
            "langwatch.output": outputValue,
          },
        });

        const gotInput = await store.get({
          projectId: coords.projectId,
          ref: refs["langwatch.input"]!,
        });
        const gotOutput = await store.get({
          projectId: coords.projectId,
          ref: refs["langwatch.output"]!,
        });

        expect(gotInput).toBe(inputValue);
        expect(gotOutput).toBe(outputValue);
      });

      it("with a manifest cache, the manifest is only fetched once for two fields on the same span", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));

        const refs = await store.put({
          ...coords,
          fields: {
            "langwatch.input": "input value",
            "langwatch.output": "output value",
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manifestCache = new Map<string, any>();
        await store.get({
          projectId: coords.projectId,
          ref: refs["langwatch.input"]!,
          manifestCache,
        });
        await store.get({
          projectId: coords.projectId,
          ref: refs["langwatch.output"]!,
          manifestCache,
        });

        // One PutObjectCommand + ONE GetObjectCommand (not two)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const getCalls = (fake.s3Client as any).send.mock.calls.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c: any) => c[0] instanceof GetObjectCommand,
        );
        expect(getCalls).toHaveLength(1);
      });
    });
  });

  describe("given a field whose value was tampered in the manifest", () => {
    it("throws BlobIntegrityError (sha256 mismatch)", async () => {
      const fake = fakeS3();
      const store = new BlobStore(resolverFor(fake));

      const refs = await store.put({
        ...coords,
        fields: { "langwatch.output": "original" },
      });

      // Overwrite the manifest with a tampered value for langwatch.output
      const manifestKey = `orgA-bucket/trace-blobs/orgA:1/trace-1/span-1`;
      const tampered = JSON.stringify({
        version: 1,
        encoding: "utf-8",
        fields: { "langwatch.output": "tampered" },
      });
      fake.objects.set(manifestKey, Buffer.from(tampered, "utf-8"));

      await expect(
        store.get({ projectId: coords.projectId, ref: refs["langwatch.output"]! }),
      ).rejects.toBeInstanceOf(BlobIntegrityError);
    });
  });

  describe("given a manifest that is missing the requested field", () => {
    it("throws BlobFieldNotFoundError", async () => {
      const fake = fakeS3();
      const store = new BlobStore(resolverFor(fake));

      // Put manifest with only langwatch.input
      const refs = await store.put({
        ...coords,
        fields: { "langwatch.input": "some input" },
      });

      // Construct a stale ref pointing at langwatch.output which is not in the manifest
      const staleRef: TraceBlobRef = {
        ...refs["langwatch.input"]!,
        field: "langwatch.output",
        sha256: "doesnotmatter",
        size: 99,
      };

      await expect(
        store.get({ projectId: coords.projectId, ref: staleRef }),
      ).rejects.toBeInstanceOf(BlobFieldNotFoundError);
    });
  });

  describe("given the positional key", () => {
    it("is project/trace/span scoped under the trace-blobs prefix (no attrKey)", () => {
      expect(BlobStore.blobKey(coords)).toBe(
        "trace-blobs/orgA:1/trace-1/span-1",
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
      it("throws UnauthorizedBlobAccessError before even reaching S3", async () => {
        const fake = fakeS3();
        const store = new BlobStore(resolverFor(fake));
        const refs = await store.put({
          ...coords,
          fields: { "langwatch.output": "secret" },
        });

        await expect(
          store.get({ projectId: "orgB:9", ref: refs["langwatch.output"]! }),
        ).rejects.toBeInstanceOf(UnauthorizedBlobAccessError);
      });
    });
  });

  describe("given a blob ref whose key belongs to a different project", () => {
    describe("when get is called with a mismatched projectId", () => {
      it("throws UnauthorizedBlobAccessError without calling the S3 client", async () => {
        const sendSpy = vi.fn(async (_command: unknown) => ({}));
        const fakeWithSpy = {
          objects: new Map<string, Buffer>(),
          s3Client: { send: sendSpy } as never,
        };
        const store = new BlobStore(async (_projectId: string) => ({
          s3Client: fakeWithSpy.s3Client,
          s3Bucket: "any-bucket",
        }));

        const foreignRef: TraceBlobRef = {
          key: "trace-blobs/orgA:1/trace-1/span-1",
          field: "langwatch.output",
          size: 10,
          sha256: "abc",
          encoding: "utf-8",
        };

        await expect(
          store.get({ projectId: "orgB:9", ref: foreignRef }),
        ).rejects.toBeInstanceOf(UnauthorizedBlobAccessError);

        expect(sendSpy).not.toHaveBeenCalled();
      });
    });
  });
});
