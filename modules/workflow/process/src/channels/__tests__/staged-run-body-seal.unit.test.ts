import { createDecipheriv } from "node:crypto";

import { studioClientEventSchema } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { LambdaWorkflowStudioStreamChannel } from "../aws.lambda-workflow-studio-stream.channel.ts";
import {
  STAGED_PAYLOAD_HEADER,
  STAGED_PAYLOAD_KEY_HEADER,
  type NlpLambdaStreamChunk,
  type WorkflowStudioStreamInput,
} from "../nlp-lambda.channel.ts";

const SECRET = "tok_live_partner_123";

const INPUT: WorkflowStudioStreamInput = {
  projectId: "project-1",
  body: studioClientEventSchema.parse({
    type: "execute_flow",
    payload: {
      trace_id: "trace-1",
      workflow: {
        workflow_id: "wf-1",
        api_key: "k",
        spec_version: "1.4",
        name: "Test",
        icon: "x",
        description: "x",
        version: "1.0",
        template_adapter: "default",
        default_llm: { model: "openai/gpt-5-mini" },
        nodes: [],
        edges: [],
        state: { execution: { status: "idle" } },
        secrets: { PARTNER_TOKEN: SECRET },
      },
    },
  }),
  origin: "workflow",
};

function open(input: { sealed: Buffer; key: string }): string {
  const key = Buffer.from(input.key, "base64");
  const nonce = input.sealed.subarray(0, 12);
  const tag = input.sealed.subarray(input.sealed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(input.sealed.subarray(12, input.sealed.length - 16)),
    decipher.final(),
  ]).toString("utf-8");
}

describe("a run body parked in object storage for the Lambda invoke", () => {
  /** @scenario A staged oversized run body carries no readable secret */
  it("is stored sealed, and only the invoke envelope carries the key that opens it", async () => {
    const stored: Buffer[] = [];
    const payloads: string[] = [];
    const channel = LambdaWorkflowStudioStreamChannel.create({
      functions: { arnFor: async () => "arn:aws:lambda:eu-central-1:123:function:nlp" },
      invoke: {
        invokeStream: async (call) => {
          payloads.push(call.payload);

          return (async function* (): AsyncGenerator<NlpLambdaStreamChunk> {})();
        },
      },
      staging: {
        stage: async (call) => {
          stored.push(call.serialized);

          return { url: "https://s3.example/staged?signed=yes", discard: async () => undefined };
        },
      },
      stagingThresholdBytes: 10,
      stagingTtlSeconds: 600,
    });

    const reader = await channel.open(INPUT);
    await reader.read();

    const [sealed] = stored;
    const envelope = JSON.parse(payloads[0] ?? "{}") as { headers: Record<string, string> };
    expect(sealed?.toString("utf-8")).not.toContain(SECRET);
    expect(sealed?.toString("latin1")).not.toContain("secrets");
    expect(envelope.headers[STAGED_PAYLOAD_HEADER]).toContain("s3.example");
    const key = envelope.headers[STAGED_PAYLOAD_KEY_HEADER] ?? "";
    expect(open({ sealed: sealed ?? Buffer.alloc(0), key })).toBe(JSON.stringify(INPUT.body));
  });
});
