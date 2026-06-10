/**
 * Unit tests for stagedLangevalsFetch — the helper that decides whether
 * to POST a langevals request inline or stage it via a presigned S3 URL.
 *
 * Three branches matter:
 *   1. body <= threshold → direct POST, no S3 write
 *   2. threshold < body <= cap → upload to S3, send presigned URL via
 *      X-Payload-S3-URL header, empty body
 *   3. body > cap → throw PayloadTooLargeError before any network call
 *
 * We mock S3Client, the presigner, and global fetch so the test stays
 * pure-function. The contract under test is the decision logic + the
 * shape of the outbound request, not the AWS SDK plumbing itself.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const s3SendCalls: any[] = [];
const presignerCalls: any[] = [];
const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];

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
    return `https://s3.example/${command.input.Bucket}/${encodeURIComponent(
      command.input.Key,
    )}?signed=yes&expires=${opts.expiresIn}`;
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
    s3Bucket: "test-staging-bucket",
  })),
}));

vi.mock("../../../env.mjs", () => ({
  env: {
    LANGEVALS_STAGING_THRESHOLD_BYTES: 1000,
    LANGEVALS_STAGING_TTL_SECONDS: 600,
    EVAL_MAX_PAYLOAD_BYTES: 5000,
    TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: 50000,
  },
}));

import {
  PayloadTooLargeError,
  stagedLangevalsFetch,
} from "../stagedFetch";

beforeEach(() => {
  s3SendCalls.length = 0;
  presignerCalls.length = 0;
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

describe("stagedLangevalsFetch", () => {
  describe("given a body below the staging threshold", () => {
    /** @scenario "Small eval payload posts inline" */
    it("posts inline with no S3 upload", async () => {
      await stagedLangevalsFetch({
        url: "https://langevals.test/openai/factuality/evaluate",
        body: { small: "payload" },
        projectId: "project_unit_a",
        kind: "evaluation",
      });

      expect(s3SendCalls).toHaveLength(0);
      expect(presignerCalls).toHaveLength(0);
      expect(fetchCalls).toHaveLength(1);

      const init = fetchCalls[0]!.init!;
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(Buffer);
      expect((init.body as Buffer).toString("utf-8")).toBe(
        JSON.stringify({ small: "payload" }),
      );

      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Payload-S3-URL"]).toBeUndefined();
    });
  });

  describe("given a body above the staging threshold but below the cap", () => {
    /** @scenario "Large topic clustering payload stages via presigned URL" */
    it("uploads to S3 and forwards the presigned URL", async () => {
      const big = { traces: "x".repeat(2000) };

      await stagedLangevalsFetch({
        url: "https://langevals.test/topics/batch_clustering",
        body: big,
        projectId: "project_unit_b",
        kind: "topic_clustering_batch",
      });

      const put = s3SendCalls.find((c) => c.type === "Put")!;
      expect(put.input.Bucket).toBe("test-staging-bucket");
      expect(put.input.Key).toMatch(
        /^langevals-staging\/project_unit_b\/topic_clustering_batch\/\d+-[\w-]+\.json$/,
      );
      expect(put.input.ContentType).toBe("application/json");

      expect(presignerCalls).toHaveLength(1);
      expect(presignerCalls[0]!.opts.expiresIn).toBe(600);

      expect(fetchCalls).toHaveLength(1);
      const init = fetchCalls[0]!.init!;
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();

      const headers = init.headers as Record<string, string>;
      expect(headers["X-Payload-S3-URL"]).toContain("https://s3.example/");
      expect(headers["X-Payload-S3-URL"]).toContain("signed=yes");
    });

    /** @scenario "Staged S3 object is deleted after the upstream responds" */
    it("deletes the staged S3 object after the upstream responds", async () => {
      const big = { traces: "x".repeat(2000) };

      await stagedLangevalsFetch({
        url: "https://langevals.test/topics/batch_clustering",
        body: big,
        projectId: "project_unit_cleanup",
        kind: "topic_clustering_batch",
      });

      const put = s3SendCalls.find((c) => c.type === "Put")!;
      const del = s3SendCalls.find((c) => c.type === "Delete")!;
      expect(put).toBeDefined();
      expect(del).toBeDefined();
      // Same bucket + key written is the key deleted.
      expect(del.input.Bucket).toBe(put.input.Bucket);
      expect(del.input.Key).toBe(put.input.Key);
    });
  });

  describe("given a body above the per-kind hard cap", () => {
    /** @scenario "Eval payload above the eval hard cap is rejected before any network call" */
    it("throws PayloadTooLargeError before any network call", async () => {
      const oversized = { traces: "x".repeat(6000) };

      await expect(
        stagedLangevalsFetch({
          url: "https://langevals.test/openai/factuality/evaluate",
          body: oversized,
          projectId: "project_unit_c",
          kind: "evaluation",
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeError);

      expect(s3SendCalls).toHaveLength(0);
      expect(presignerCalls).toHaveLength(0);
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("when the kind is topic_clustering_batch", () => {
    /** @scenario "Topic clustering payload above the eval cap but below the clustering cap stages successfully" */
    it("applies the higher topic-clustering cap", async () => {
      const between = { traces: "x".repeat(6000) };

      await expect(
        stagedLangevalsFetch({
          url: "https://langevals.test/topics/batch_clustering",
          body: between,
          projectId: "project_unit_d",
          kind: "topic_clustering_batch",
        }),
      ).resolves.toBeInstanceOf(Response);

      expect(s3SendCalls.some((c) => c.type === "Put")).toBe(true);
    });
  });

  describe("when LANGEVALS_STAGING_THRESHOLD_BYTES is not configured", () => {
    /** @scenario "Self-hosted langevals never stages regardless of payload size" */
    it("posts inline regardless of payload size", async () => {
      vi.resetModules();
      vi.doMock("../../../env.mjs", () => ({
        env: {
          LANGEVALS_STAGING_THRESHOLD_BYTES: undefined,
          LANGEVALS_STAGING_TTL_SECONDS: 600,
          EVAL_MAX_PAYLOAD_BYTES: 50_000,
          TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: 500_000,
        },
      }));
      const { stagedLangevalsFetch: optInFetch } = await import(
        "../stagedFetch"
      );

      const big = { traces: "x".repeat(20_000) };

      await optInFetch({
        url: "https://langevals.test/topics/batch_clustering",
        body: big,
        projectId: "project_unit_e",
        kind: "topic_clustering_batch",
      });

      expect(s3SendCalls).toHaveLength(0);
      expect(presignerCalls).toHaveLength(0);
      expect(fetchCalls).toHaveLength(1);
      const headers = fetchCalls[0]!.init!.headers as Record<string, string>;
      expect(headers["X-Payload-S3-URL"]).toBeUndefined();

      vi.doUnmock("../../../env.mjs");
    });
  });
});
