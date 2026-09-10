/**
 * The per-project NLP engine's Lambda invoke path and its S3 staging decision.
 *
 * @see specs/nlp-go/lambda-invoke-payload-staging.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvokePayloadTooLargeError,
  NlpInvokeTransportAdapter,
  type NlpInvokeStagingConfig,
} from "../workflow-nlp-lambda.adapter.ts";
import {
  NlpLambdaInvoke,
  NlpPayloadStaging,
  type NlpLambdaInvokeResult,
  type StagedNlpPayload,
} from "../../app/workflow.app.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";

type StageCall = {
  projectId: string;
  keyPrefix: string;
  serialized: Buffer;
  ttlSeconds: number;
};

class RecordingLambda implements NlpLambdaInvoke {
  readonly payloads: string[] = [];
  rejectWith: Error | null = null;

  async invoke(input: { functionArn: string; payload: string }): Promise<NlpLambdaInvokeResult> {
    this.payloads.push(input.payload);
    if (this.rejectWith) throw this.rejectWith;
    return { statusCode: 200, payload: '{"ok":true}' };
  }
}

class RecordingStaging implements NlpPayloadStaging {
  readonly calls: StageCall[] = [];
  readonly discarded: string[] = [];

  async stage(input: StageCall): Promise<StagedNlpPayload> {
    this.calls.push(input);
    const key = `${input.keyPrefix}/staged.json`;
    return {
      url: `https://s3.example/test-staging-bucket/${encodeURIComponent(input.keyPrefix)}?signed=yes`,
      discard: async () => void this.discarded.push(key),
    };
  }
}

const BASE_CONFIG: NlpInvokeStagingConfig = {
  stagingThresholdBytes: 1000,
  stagingTtlSeconds: 600,
  maxPayloadBytes: 16_000_000,
};

function transport(overrides: Partial<NlpInvokeStagingConfig> = {}) {
  const lambda = new RecordingLambda();
  const staging = new RecordingStaging();
  return {
    lambda,
    staging,
    subject: NlpInvokeTransportAdapter.create({
      target: ARN,
      config: { ...BASE_CONFIG, ...overrides },
      lambda,
      staging,
    }),
    lastEnvelope: () => JSON.parse(lambda.payloads[lambda.payloads.length - 1]!),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given the NLP engine is a per-project Lambda", () => {
  describe("when the serialized envelope is below the staging threshold", () => {
    /** @scenario "A small invoke is sent inline" */
    it("sends the body inline with no S3 upload and no staged header", async () => {
      const { subject, staging, lastEnvelope } = transport();

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ small: "payload" }),
        projectId: "project_a",
      });

      expect(staging.calls).toHaveLength(0);
      const envelope = lastEnvelope();
      expect(envelope.body).toBe(JSON.stringify({ small: "payload" }));
      expect(envelope.headers["X-Payload-S3-URL"]).toBeUndefined();
    });
  });

  describe("when the serialized envelope is above the staging threshold", () => {
    const bigBody = JSON.stringify({ traces: "x".repeat(2000) });

    /** @scenario "A large invoke is staged via a presigned URL" */
    it("stages to S3 and rewrites the envelope to an empty body and staged header", async () => {
      const { subject, staging, lambda, lastEnvelope } = transport();

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigBody,
        projectId: "project_b",
      });

      expect(staging.calls).toHaveLength(1);
      expect(staging.calls[0]!.projectId).toBe("project_b");
      expect(staging.calls[0]!.keyPrefix).toBe("nlpgo-staging/project_b");
      expect(staging.calls[0]!.ttlSeconds).toBe(600);
      expect(staging.calls[0]!.serialized.toString("utf-8")).toBe(bigBody);

      const envelope = lastEnvelope();
      expect(envelope.body).toBe("");
      expect(envelope.headers["X-Payload-S3-URL"]).toContain("https://s3.example/");
      // The rewritten envelope must be comfortably under the 6 MiB cap.
      expect(Buffer.byteLength(lambda.payloads[0]!, "utf-8")).toBeLessThan(6291456);
    });

    /** @scenario "A staged object is deleted after the invoke returns" */
    it("deletes the staged object after the invoke returns", async () => {
      const { subject, staging } = transport();

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        body: bigBody,
        projectId: "project_cleanup",
      });

      expect(staging.calls).toHaveLength(1);
      expect(staging.discarded).toEqual(["nlpgo-staging/project_cleanup/staged.json"]);
    });

    /** @scenario "A staged object is deleted even when the invoke fails" */
    it("reaps the staged object and propagates the error when the invoke rejects", async () => {
      const { subject, staging, lambda } = transport();
      lambda.rejectWith = new Error("lambda boom");

      await expect(
        subject.send({
          path: "/go/studio/execute_sync",
          method: "POST",
          body: bigBody,
          projectId: "project_failure",
        }),
      ).rejects.toThrow("lambda boom");

      // The whole point of the finally block: the staged object is reaped even
      // though the invoke threw, so a failed run does not leak an S3 object.
      expect(staging.calls).toHaveLength(1);
      expect(staging.discarded).toEqual(["nlpgo-staging/project_failure/staged.json"]);
    });
  });

  describe("when the body is larger than the maximum payload cap", () => {
    /** @scenario "An invoke body over the hard cap is rejected before staging" */
    it("throws before staging or invoking instead of offloading an unbounded body", async () => {
      const { subject, staging, lambda } = transport({ maxPayloadBytes: 2000 });

      await expect(
        subject.send({
          path: "/go/studio/execute_sync",
          method: "POST",
          body: JSON.stringify({ traces: "x".repeat(5000) }),
          projectId: "project_oversized",
        }),
      ).rejects.toBeInstanceOf(InvokePayloadTooLargeError);

      // Fail fast: nothing was staged and no Lambda invoke was attempted.
      expect(staging.calls).toHaveLength(0);
      expect(lambda.payloads).toHaveLength(0);
    });
  });

  describe("when a body below the threshold only crosses it once escaped into the envelope", () => {
    /** @scenario "Staging triggers on the real serialized envelope, not the raw body" */
    it("stages based on the serialized envelope size, not the raw body size", async () => {
      // A run of double quotes: each is one raw byte but two inside the JSON
      // envelope, so the envelope is roughly twice the raw body.
      const body = '"'.repeat(500);
      const rawBytes = Buffer.byteLength(body, "utf-8");
      // Threshold above the raw body but below the escaped envelope: a naive
      // raw-body check would not stage, the envelope-based check must.
      const { subject, staging } = transport({ stagingThresholdBytes: rawBytes + 5 });

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        body,
        projectId: "project_escape",
      });

      expect(staging.calls).toHaveLength(1);
    });
  });

  describe("when no staging threshold is configured", () => {
    /** @scenario "Staging falls back to a built-in threshold when the env var is unset" */
    it("falls back to the built-in default and still stages an oversized body", async () => {
      const { subject, staging } = transport({ stagingThresholdBytes: undefined });

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        body: JSON.stringify({ traces: "x".repeat(5 * 1024 * 1024 + 64) }),
        projectId: "project_fallback",
      });

      expect(staging.calls).toHaveLength(1);
    });
  });
});

describe("given a plain HTTP NLP target instead of a Lambda ARN", () => {
  describe("when any body is sent", () => {
    /** @scenario "A self-hosted HTTP nlpgo target never stages" */
    it("never stages and posts the body inline", async () => {
      const lambda = new RecordingLambda();
      const staging = new RecordingStaging();
      const call = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
      const subject = NlpInvokeTransportAdapter.create({
        target: "http://localhost:5561",
        config: BASE_CONFIG,
        lambda,
        staging,
        fetch: call as unknown as typeof fetch,
      });

      await subject.send({
        path: "/go/studio/execute_sync",
        method: "POST",
        body: JSON.stringify({ traces: "x".repeat(2000) }),
        projectId: "project_selfhosted",
      });

      expect(staging.calls).toHaveLength(0);
      expect(lambda.payloads).toHaveLength(0);
      expect(call).toHaveBeenCalledOnce();
    });
  });
});
