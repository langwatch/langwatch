/**
 * Unit tests for BlobStore spool operations (ADR-022 write/read path).
 *
 * Covers: putSpool, getSpool, deleteSpool.
 * getFromEventLog is covered by blob-store.event-log.unit.test.ts.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BlobStore,
  type S3ClientResolver,
} from "./blob-store.service";

/**
 * In-memory fake S3 keyed by `${bucket}/${key}`.
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
        Body: {
          transformToByteArray: async () => new Uint8Array(stored),
        },
      };
    }
    if (command instanceof DeleteObjectCommand) {
      const { Bucket, Key } = command.input;
      objects.delete(`${Bucket}/${Key}`);
      return {};
    }
    throw new Error("unexpected command");
  });
  return { objects, s3Client: { send } as never };
}

function resolverFor(fake: ReturnType<typeof fakeS3>): S3ClientResolver {
  return async (_projectId: string) => ({
    s3Client: fake.s3Client,
    s3Bucket: "test-bucket",
  });
}

const spoolCoords = {
  projectId: "orgA",
  traceId: "trace-1",
  spanId: "span-1",
};

describe("BlobStore — spool operations (ADR-022)", () => {
  describe("putSpool", () => {
    describe("given a span payload body", () => {
      describe("when putSpool is called", () => {
        it("returns the spool key with the correct shape trace-blobs/spool/{projectId}/{traceId}/{spanId}", async () => {
          const fake = fakeS3();
          const store = new BlobStore(resolverFor(fake));
          const body = Buffer.from("span payload data", "utf-8");

          const spoolRef = await store.putSpool({ ...spoolCoords, body });

          expect(spoolRef).toBe(
            `trace-blobs/spool/${spoolCoords.projectId}/${spoolCoords.traceId}/${spoolCoords.spanId}`,
          );
        });

        it("issues exactly ONE PutObjectCommand", async () => {
          const fake = fakeS3();
          const store = new BlobStore(resolverFor(fake));
          const body = Buffer.from("payload", "utf-8");

          await store.putSpool({ ...spoolCoords, body });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const putCalls = (fake.s3Client as any).send.mock.calls.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (c: any) => c[0] instanceof PutObjectCommand,
          );
          expect(putCalls).toHaveLength(1);
        });
      });
    });
  });

  describe("getSpool", () => {
    describe("given a spool ref written by putSpool", () => {
      describe("when getSpool is called with the same ref", () => {
        it("returns the exact bytes that were put", async () => {
          const fake = fakeS3();
          const store = new BlobStore(resolverFor(fake));
          const originalBody = Buffer.from("exact span body bytes", "utf-8");

          const spoolRef = await store.putSpool({ ...spoolCoords, body: originalBody });
          const retrieved = await store.getSpool(spoolRef);

          expect(retrieved).toEqual(originalBody);
        });
      });
    });
  });

  describe("deleteSpool", () => {
    describe("given an existing spool object", () => {
      describe("when deleteSpool is called", () => {
        it("issues a DeleteObjectCommand for the spool key", async () => {
          const fake = fakeS3();
          const store = new BlobStore(resolverFor(fake));
          const body = Buffer.from("to be deleted", "utf-8");
          const spoolRef = await store.putSpool({ ...spoolCoords, body });

          await store.deleteSpool(spoolRef);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const deleteCalls = (fake.s3Client as any).send.mock.calls.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (c: any) => c[0] instanceof DeleteObjectCommand,
          );
          expect(deleteCalls).toHaveLength(1);
        });
      });
    });

    describe("given a spool ref that does not exist", () => {
      describe("when deleteSpool is called", () => {
        it("does not throw (best-effort — errors are swallowed)", async () => {
          const throwingS3 = {
            send: vi.fn(async () => {
              throw new Error("AccessDenied");
            }),
          };
          const store = new BlobStore(async () => ({
            s3Client: throwingS3 as never,
            s3Bucket: "bucket",
          }));

          await expect(
            store.deleteSpool("trace-blobs/spool/proj/trace/span"),
          ).resolves.not.toThrow();
        });
      });
    });
  });
});
