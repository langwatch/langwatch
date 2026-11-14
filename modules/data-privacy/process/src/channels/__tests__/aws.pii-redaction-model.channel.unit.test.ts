import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { LangevalsPiiDetectionError } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { AwsPiiRedactionModelChannel } from "../aws.pii-redaction-model.channel.ts";

const ARN =
  "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live";
const SEPARATOR = "\u0000".repeat(8);
const ANSWER = JSON.stringify([
  { status: "processed", raw_response: { anonymized: "hi <PERSON>" } },
  { status: "skipped" },
]);

function framed({ status, body }: { status: number; body: string }): Uint8Array {
  return Buffer.from(`{"statusCode":${status},"headers":{}}${SEPARATOR}${body}`, "utf-8");
}

function channelAnswering(answer: { Payload?: Uint8Array; FunctionError?: string } | Error) {
  const sent: { command: InvokeCommand; abortSignal?: AbortSignal | undefined }[] = [];
  const lambda = {
    send: (command: InvokeCommand, options: { abortSignal?: AbortSignal }) => {
      sent.push({ command, abortSignal: options.abortSignal });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  } as never;
  const channel = AwsPiiRedactionModelChannel.create({ lambda, functionArn: ARN });
  return { channel, sent };
}

const batch = (texts: readonly string[] = ["hi Ana", "nothing"]) => ({
  texts,
  entities: ["PERSON"],
  signal: new AbortController().signal,
});

describe("AwsPiiRedactionModelChannel", () => {
  describe("when the model answers a framed 2xx", () => {
    /** @scenario "The model's Lambda answer is read through the Web Adapter prelude" */
    it("invokes the alias with an HTTP event for the Presidio route and reads the body", async () => {
      const { channel, sent } = channelAnswering({
        Payload: framed({ status: 200, body: ANSWER }),
      });
      const request = batch();

      const outcome = await channel.detect(request);

      expect(outcome).toEqual({ kind: "detected", results: JSON.parse(ANSWER) });
      const input = sent[0]!.command.input;
      expect(input.FunctionName).toBe(ARN);
      expect(input.InvocationType).toBe("RequestResponse");
      const event = JSON.parse(
        typeof input.Payload === "string" ? input.Payload : "not a string payload",
      );
      expect(event).toMatchObject({
        rawPath: "/presidio/pii_detection/evaluate",
        requestContext: { http: { method: "POST" } },
        headers: { "content-type": "application/json" },
      });
      expect(JSON.parse(event.body)).toEqual({
        data: [{ input: "hi Ana" }, { input: "nothing" }],
        settings: { entities: { person: true }, min_threshold: 0.5 },
        env: {},
      });
      expect(sent[0]!.abortSignal).toBe(request.signal);
    });

    it("sends nothing for an empty batch", async () => {
      const { channel, sent } = channelAnswering(new Error("must not invoke"));

      await expect(channel.detect(batch([]))).resolves.toEqual({ kind: "detected", results: [] });
      expect(sent).toHaveLength(0);
    });
  });

  describe("when the answer is not a framed 2xx with one result per text", () => {
    /** @scenario "The model's Lambda answer is read through the Web Adapter prelude" */
    it.each([
      ["no prelude delimiter", { Payload: Buffer.from(ANSWER, "utf-8") }],
      ["a non-2xx status", { Payload: framed({ status: 503, body: '{"detail":"busy"}' }) }],
      [
        "a prelude cut before its delimiter",
        { Payload: Buffer.from('{"statusCode":200', "utf-8") },
      ],
      ["a body cut short", { Payload: framed({ status: 200, body: ANSWER.slice(0, 30) }) }],
      [
        "one result for two texts",
        { Payload: framed({ status: 200, body: '[{"status":"skipped"}]' }) },
      ],
      ["an empty payload", {}],
      [
        "a function error",
        { FunctionError: "Unhandled", Payload: framed({ status: 200, body: ANSWER }) },
      ],
    ])("refuses %s", async (_case, answer) => {
      const { channel } = channelAnswering(answer);

      await expect(channel.detect(batch())).rejects.toBeInstanceOf(LangevalsPiiDetectionError);
    });

    it("passes on an invoke the SDK refused", async () => {
      const { channel } = channelAnswering(new Error("AccessDeniedException"));

      await expect(channel.detect(batch())).rejects.toThrow("AccessDeniedException");
    });
  });
});
