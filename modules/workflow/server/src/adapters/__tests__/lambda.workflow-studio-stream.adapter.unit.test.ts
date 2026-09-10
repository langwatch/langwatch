/**
 * The studio's per-project Lambda stream: its framing, its staging decision,
 * and what a caller sees when the invocation fails or is walked away from.
 *
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import { describe, expect, it } from "vitest";
import { NlpLambdaFunctionPort } from "../../app/workflow.app.ts";
import {
  NlpLambdaStreamInvoke,
  type NlpLambdaStreamChunk,
} from "../../app/workflow.app.ts";
import {
  NlpPayloadStaging,
  STAGED_PAYLOAD_HEADER,
  type StagedNlpPayload,
} from "../../app/workflow.app.ts";
import type { WorkflowStudioStreamInput } from "../../app/workflow.app.ts";
import { LambdaWorkflowStudioStreamAdapter } from "../lambda.workflow-studio-stream.adapter.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:langwatch_nlp-project-1";

const INPUT: WorkflowStudioStreamInput = {
  projectId: "project-1",
  body: { type: "is_alive" } as WorkflowStudioStreamInput["body"],
  origin: "workflow",
};

class FixedFunctions implements NlpLambdaFunctionPort {
  readonly asked: string[] = [];

  arnFor(input: { projectId: string }): Promise<string> {
    this.asked.push(input.projectId);

    return Promise.resolve(ARN);
  }
}

class RecordingStaging implements NlpPayloadStaging {
  readonly staged: { projectId: string; keyPrefix: string; bytes: number }[] = [];
  discards = 0;

  stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedNlpPayload> {
    this.staged.push({
      projectId: input.projectId,
      keyPrefix: input.keyPrefix,
      bytes: input.serialized.byteLength,
    });

    return Promise.resolve({
      url: "https://s3.example/staged?signed=yes",
      discard: () => {
        this.discards += 1;

        return Promise.resolve();
      },
    });
  }
}

class ScriptedInvoke implements NlpLambdaStreamInvoke {
  readonly payloads: string[] = [];
  signal: AbortSignal | undefined;

  constructor(private readonly script: readonly NlpLambdaStreamChunk[]) {
  }

  invokeStream(input: {
    functionArn: string;
    payload: string;
    signal?: AbortSignal | undefined;
  }): Promise<AsyncIterable<NlpLambdaStreamChunk>> {
    this.payloads.push(input.payload);
    this.signal = input.signal;
    const script = this.script;

    return Promise.resolve(
      (async function* () {
        for (const chunk of script) {
          yield chunk;
        }
      })(),
    );
  }
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A Lambda Web Adapter RESPONSE_STREAM frame: prelude, eight NULs, body. */
function framed(statusCode: number, body: string): Uint8Array {
  const prelude = bytes(JSON.stringify({ statusCode, headers: {}, cookies: [] }));
  const out = new Uint8Array(prelude.length + 8 + bytes(body).length);
  out.set(prelude, 0);
  out.set(bytes(body), prelude.length + 8);

  return out;
}

function adapter(options: {
  invoke: NlpLambdaStreamInvoke;
  staging?: NlpPayloadStaging | undefined;
  thresholdBytes?: number;
}) {
  const functions = new FixedFunctions();

  return {
    functions,
    subject: LambdaWorkflowStudioStreamAdapter.create({
      functions,
      invoke: options.invoke,
      staging: options.staging,
      stagingThresholdBytes: options.thresholdBytes ?? 5_000_000,
      stagingTtlSeconds: 600,
    }),
  };
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const read = await reader.read();
    if (read.done) return text;
    text += decoder.decode(read.value, { stream: true });
  }
}

describe("given a project whose studio runs on its own Lambda", () => {
  describe("when the engine streams its events", () => {
    /** @scenario "Studio events arrive in order with the Lambda prelude stripped" */
    it("hands the caller the body frames in order and never the prelude", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(200, 'data: {"type":"is_alive_response"}\n\n') },
        { kind: "payload", bytes: bytes('data: {"type":"done"}\n\n') },
      ]);
      const { subject, functions } = adapter({ invoke });

      const text = await drain(await subject.open(INPUT));

      expect(text).toBe('data: {"type":"is_alive_response"}\n\ndata: {"type":"done"}\n\n');
      expect(functions.asked).toEqual(["project-1"]);
    });

    /** @scenario "The studio run is invoked on the project's own function" */
    it("posts the studio route and the run's origin in the invoke envelope", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(200, 'data: {"type":"done"}\n\n') },
      ]);
      const { subject } = adapter({ invoke });

      await drain(await subject.open(INPUT));

      const envelope = JSON.parse(invoke.payloads[0] ?? "{}") as {
        rawPath: string;
        headers: Record<string, string>;
        body: string;
      };
      expect(envelope.rawPath).toBe("/go/studio/execute");
      expect(envelope.headers["X-LangWatch-Origin"]).toBe("workflow");
      expect(envelope.body).toBe(JSON.stringify(INPUT.body));
    });
  });

  describe("when the invocation fails mid-stream", () => {
    /** @scenario "A failed invocation reaches the caller as a named workflow failure" */
    it("fails the stream with the workflow execution code", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(200, 'data: {"type":"start"}\n\n') },
        { kind: "failed", errorCode: "Runtime.OutOfMemory" },
      ]);
      const { subject } = adapter({ invoke });

      const reader = await subject.open(INPUT);
      await reader.read();

      await expect(drain(reader)).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });
    });

    /** @scenario "A non-success status reaches the caller as a named workflow failure" */
    it("fails the stream when the engine answered with an error status", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(422, '{"detail":"invalid graph"}') },
      ]);
      const { subject } = adapter({ invoke });

      await expect(drain(await subject.open(INPUT))).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });
    });
  });

  describe("when the viewer walks away from the run", () => {
    /** @scenario "Cancelling the stream aborts the invocation" */
    it("aborts the invocation rather than leaving it running", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(200, 'data: {"type":"start"}\n\n') },
      ]);
      const { subject } = adapter({ invoke });

      const reader = await subject.open(INPUT);
      await reader.read();
      await reader.cancel();

      expect(invoke.signal?.aborted).toBe(true);
    });
  });

  describe("when the graph is larger than one invoke may carry", () => {
    /** @scenario "An oversized studio payload is parked in object storage" */
    it("parks the body, sends its URL instead, and drops it afterwards", async () => {
      const invoke = new ScriptedInvoke([
        { kind: "payload", bytes: framed(200, 'data: {"type":"done"}\n\n') },
      ]);
      const staging = new RecordingStaging();
      const { subject } = adapter({ invoke, staging, thresholdBytes: 4 });

      await drain(await subject.open(INPUT));

      const envelope = JSON.parse(invoke.payloads[0] ?? "{}") as {
        headers: Record<string, string>;
        body: string;
      };
      expect(envelope.body).toBe("");
      expect(envelope.headers[STAGED_PAYLOAD_HEADER]).toBe("https://s3.example/staged?signed=yes");
      expect(staging.staged).toEqual([
        { projectId: "project-1", keyPrefix: "studio-staging/project-1", bytes: 19 },
      ]);
      expect(staging.discards).toBe(1);
    });

    /** @scenario "An oversized studio payload with nowhere to park refuses by name" */
    it("refuses by name where the deployment composed no object storage", async () => {
      const invoke = new ScriptedInvoke([]);
      const { subject } = adapter({ invoke, thresholdBytes: 4 });

      await expect(subject.open(INPUT)).rejects.toMatchObject({
        code: "workflow_execution_failed",
      });
      expect(invoke.payloads).toEqual([]);
    });
  });
});
