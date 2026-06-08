/**
 * Unit tests for lambdaFetch's S3 staging decision on the Lambda-ARN invoke
 * path. The AWS SDK InvokeFunction Payload is capped at 6 MiB; without staging,
 * a large workflow/evaluation body fails with "Request must be smaller than
 * 6291456 bytes for the InvokeFunction operation". These tests pin the decision
 * logic + the shape of the rewritten invoke envelope, not stagePayloadToS3's
 * own S3 plumbing (covered by src/server/s3/__tests__/stagePayload.unit.test.ts).
 *
 * We mock at the stagePayloadToS3 boundary + the Lambda client so the test is a
 * pure-function check of lambdaFetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so these are initialized before the hoisted vi.mock factories
// (which reference them) run at import time.
const { invokePayloads, stageCalls, deleteCalls, mockEnv } = vi.hoisted(() => ({
  invokePayloads: [] as string[],
  stageCalls: [] as any[],
  deleteCalls: [] as any[],
  mockEnv: {
    LANGEVALS_STAGING_THRESHOLD_BYTES: 1000,
    LANGEVALS_STAGING_TTL_SECONDS: 600,
  } as Record<string, unknown>,
}));

vi.mock("../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: class {
    constructor(public input: { Payload: string }) {}
  },
}));

vi.mock("../../optimization_studio/server/lambda", () => ({
  createLambdaClient: () => ({
    send: vi.fn(async (cmd: { input: { Payload: string } }) => {
      invokePayloads.push(cmd.input.Payload);
      return { StatusCode: 200, Payload: Buffer.from('{"ok":true}', "utf-8") };
    }),
  }),
}));

vi.mock("../../server/s3/stagePayload", () => ({
  STAGED_PAYLOAD_HEADER: "X-Payload-S3-URL",
  stagePayloadToS3: vi.fn(async (input: any) => {
    stageCalls.push(input);
    return {
      s3Client: { _fake: true },
      s3Bucket: "test-staging-bucket",
      key: `${input.keyPrefix}/staged.json`,
      stagedUrl: `https://s3.example/test-staging-bucket/${encodeURIComponent(
        input.keyPrefix,
      )}?signed=yes`,
    };
  }),
  deleteStagedObject: vi.fn(async (args: any) => {
    deleteCalls.push(args);
  }),
}));

import { lambdaFetch } from "../lambdaFetch";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";

function lastEnvelope() {
  return JSON.parse(invokePayloads[invokePayloads.length - 1]!);
}

beforeEach(() => {
  invokePayloads.length = 0;
  stageCalls.length = 0;
  deleteCalls.length = 0;
  mockEnv.LANGEVALS_STAGING_THRESHOLD_BYTES = 1000;
  mockEnv.LANGEVALS_STAGING_TTL_SECONDS = 600;
});

describe("lambdaFetch staging", () => {
  describe("given the serialized envelope is below the staging threshold", () => {
    /** @scenario "A small invoke is sent inline" */
    it("sends the body inline with no S3 upload and no staged header", async () => {
      await lambdaFetch(ARN, "/go/studio/execute_sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ small: "payload" }),
        projectId: "project_a",
      });

      expect(stageCalls).toHaveLength(0);
      const env = lastEnvelope();
      expect(env.body).toBe(JSON.stringify({ small: "payload" }));
      expect(env.headers["X-Payload-S3-URL"]).toBeUndefined();
    });
  });

  describe("given the serialized envelope is above the staging threshold", () => {
    const bigBody = JSON.stringify({ traces: "x".repeat(2000) });

    /** @scenario "A large invoke is staged via a presigned URL" */
    it("stages to S3 and rewrites the envelope to an empty body + staged header", async () => {
      await lambdaFetch(ARN, "/go/studio/execute_sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigBody,
        projectId: "project_b",
      });

      expect(stageCalls).toHaveLength(1);
      expect(stageCalls[0]!.projectId).toBe("project_b");
      expect(stageCalls[0]!.keyPrefix).toBe("nlpgo-staging/project_b");
      expect(stageCalls[0]!.ttlSeconds).toBe(600);
      expect((stageCalls[0]!.serialized as Buffer).toString("utf-8")).toBe(
        bigBody,
      );

      const env = lastEnvelope();
      expect(env.body).toBe("");
      expect(env.headers["X-Payload-S3-URL"]).toContain("https://s3.example/");
      // The rewritten envelope must be comfortably under the 6 MiB cap.
      expect(
        Buffer.byteLength(invokePayloads[0]!, "utf-8"),
      ).toBeLessThan(6291456);
    });

    /** @scenario "A staged object is deleted after the invoke returns" */
    it("deletes the staged object after the invoke returns", async () => {
      await lambdaFetch(ARN, "/go/studio/execute_sync", {
        method: "POST",
        body: bigBody,
        projectId: "project_cleanup",
      });

      expect(stageCalls).toHaveLength(1);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]!.s3Bucket).toBe("test-staging-bucket");
      expect(deleteCalls[0]!.key).toBe(stageCalls[0]!.keyPrefix + "/staged.json");
      expect(deleteCalls[0]!.projectId).toBe("project_cleanup");
    });
  });

  describe("given a body below the threshold that only crosses it once escaped into the envelope", () => {
    /** @scenario "Staging triggers on the real serialized envelope, not the raw body" */
    it("stages based on the serialized envelope size, not the raw body size", async () => {
      // A run of double-quotes: each " is one raw byte but becomes \" (two
      // bytes) inside the JSON envelope, so the envelope is ~2x the raw body.
      const body = '"'.repeat(500);
      const rawBytes = Buffer.byteLength(body, "utf-8");
      // Threshold above the raw body but below the escaped envelope: a naive
      // raw-body check would NOT stage, the envelope-based check MUST.
      mockEnv.LANGEVALS_STAGING_THRESHOLD_BYTES = rawBytes + 5;

      await lambdaFetch(ARN, "/go/studio/execute_sync", {
        method: "POST",
        body,
        projectId: "project_escape",
      });

      expect(stageCalls).toHaveLength(1);
    });
  });

  describe("given LANGEVALS_STAGING_THRESHOLD_BYTES is not configured", () => {
    /** @scenario "Staging falls back to a built-in threshold when the env var is unset" */
    it("falls back to the built-in default and still stages an oversized body", async () => {
      mockEnv.LANGEVALS_STAGING_THRESHOLD_BYTES = undefined;
      const body = JSON.stringify({ traces: "x".repeat(5 * 1024 * 1024 + 64) });

      await lambdaFetch(ARN, "/go/studio/execute_sync", {
        method: "POST",
        body,
        projectId: "project_fallback",
      });

      expect(stageCalls).toHaveLength(1);
    });
  });

  describe("given a plain HTTP URL target instead of a Lambda ARN", () => {
    /** @scenario "A self-hosted HTTP nlpgo target never stages" */
    it("never stages and posts the body inline", async () => {
      const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await lambdaFetch("http://localhost:5561", "/go/studio/execute_sync", {
        method: "POST",
        body: JSON.stringify({ traces: "x".repeat(2000) }),
        projectId: "project_selfhosted",
      });

      expect(stageCalls).toHaveLength(0);
      expect(invokePayloads).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
