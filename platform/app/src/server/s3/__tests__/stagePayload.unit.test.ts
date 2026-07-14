/**
 * Unit tests for the shared S3 staging helper used by both the langevals
 * fetch path and the studio Lambda invoke path. We mock the AWS SDK + the
 * project S3 client so the test stays pure: the contract under test is the
 * key layout, the presign call, and the delete, not the SDK plumbing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const s3SendCalls: { type: string; input: any }[] = [];
const presignerCalls: { input: any; opts: any }[] = [];

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {
    public readonly _type = "Put";
    constructor(public input: any) {}
  },
  GetObjectCommand: class {
    public readonly _type = "Get";
    constructor(public input: any) {}
  },
  DeleteObjectCommand: class {
    public readonly _type = "Delete";
    constructor(public input: any) {}
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client: any, command: any, opts: any) => {
    presignerCalls.push({ input: command.input, opts });
    return `https://test-bucket.s3.eu-central-1.amazonaws.com/${encodeURIComponent(
      command.input.Key,
    )}?X-Amz-Signature=abc&expires=${opts.expiresIn}`;
  }),
}));

vi.mock("../../storage", () => ({
  createS3Client: vi.fn(async (_projectId: string) => ({
    s3Client: {
      send: vi.fn(async (cmd: any) => {
        s3SendCalls.push({ type: cmd._type, input: cmd.input });
        return {};
      }),
    },
    s3Bucket: "test-bucket",
  })),
}));

import { deleteStagedObject, stagePayloadToS3 } from "../stagePayload";

beforeEach(() => {
  s3SendCalls.length = 0;
  presignerCalls.length = 0;
});

describe("stagePayloadToS3", () => {
  describe("given a studio invoke payload to stage", () => {
    it("uploads under the given prefix and returns a presigned GET URL", async () => {
      const serialized = Buffer.from(JSON.stringify({ big: "x".repeat(100) }));

      const staged = await stagePayloadToS3({
        projectId: "project_stage_a",
        keyPrefix: "studio-staging/project_stage_a",
        serialized,
        ttlSeconds: 600,
      });

      const put = s3SendCalls.find((c) => c.type === "Put")!;
      expect(put.input.Bucket).toBe("test-bucket");
      expect(put.input.Key).toMatch(
        /^studio-staging\/project_stage_a\/\d+-[\w-]+\.json$/,
      );
      expect(put.input.ContentType).toBe("application/json");
      expect(put.input.Body).toBe(serialized);

      expect(presignerCalls).toHaveLength(1);
      expect(presignerCalls[0]!.opts.expiresIn).toBe(600);

      expect(staged.s3Bucket).toBe("test-bucket");
      expect(staged.key).toBe(put.input.Key);
      expect(staged.stagedUrl).toContain(
        "https://test-bucket.s3.eu-central-1.amazonaws.com/",
      );
      expect(staged.stagedUrl).toContain("X-Amz-Signature=abc");
    });
  });
});

describe("deleteStagedObject", () => {
  describe("given a previously staged object", () => {
    it("issues a delete for the same bucket + key", async () => {
      const serialized = Buffer.from(JSON.stringify({ big: "y".repeat(100) }));
      const staged = await stagePayloadToS3({
        projectId: "project_stage_b",
        keyPrefix: "studio-staging/project_stage_b",
        serialized,
        ttlSeconds: 600,
      });

      await deleteStagedObject({ ...staged, projectId: "project_stage_b" });

      const put = s3SendCalls.find((c) => c.type === "Put")!;
      const del = s3SendCalls.find((c) => c.type === "Delete")!;
      expect(del).toBeDefined();
      expect(del.input.Bucket).toBe(put.input.Bucket);
      expect(del.input.Key).toBe(put.input.Key);
    });
  });

  describe("when the delete fails", () => {
    it("does not throw (lifecycle rule is the fallback)", async () => {
      const staged = {
        s3Client: {
          send: vi.fn(async () => {
            throw new Error("AccessDenied");
          }),
        } as any,
        s3Bucket: "test-bucket",
        key: "studio-staging/project_stage_c/123-abc.json",
        stagedUrl: "https://test-bucket.s3.amazonaws.com/x",
      };

      await expect(
        deleteStagedObject({ ...staged, projectId: "project_stage_c" }),
      ).resolves.toBeUndefined();
    });
  });
});
