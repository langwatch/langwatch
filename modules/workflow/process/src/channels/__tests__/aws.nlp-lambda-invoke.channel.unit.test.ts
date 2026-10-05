/**
 * The AWS half of the synchronous invoke: retried only while the function provably never started.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { describe, expect, it } from "vitest";

import { AwsNlpLambdaInvokeChannel } from "../aws.nlp-lambda-invoke.channel.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:nlpgo-project";

const throttle = () =>
  Object.assign(new Error("Rate Exceeded."), { name: "TooManyRequestsException" });
const midFlight = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

function channelAnswering(answers: readonly (Error | Record<string, unknown>)[]) {
  const sent: { abortSignal?: AbortSignal | undefined }[] = [];
  const lambda = {
    send: (_command: unknown, options: { abortSignal?: AbortSignal }) => {
      sent.push(options);
      const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  } as never;
  const waits: number[] = [];
  const channel = AwsNlpLambdaInvokeChannel.create({
    lambda,
    wait: ({ ms }) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return { channel, sent, waits };
}

describe("AwsNlpLambdaInvokeChannel", () => {
  describe("when the invoke may already have reached the function", () => {
    /** @scenario "An invoke that may have started the function is not retried" */
    it("sends it once and raises the failure", async () => {
      const { channel, sent } = channelAnswering([midFlight(), { StatusCode: 200 }]);

      await expect(channel.invoke({ functionArn: ARN, payload: "{}" })).rejects.toThrow(
        "socket hang up",
      );
      expect(sent).toHaveLength(1);
    });
  });

  describe("when the control plane refused the invoke before it ran", () => {
    /** @scenario "An invoke the service rejected before running is retried" */
    it("sends it again after a backoff and answers the later attempt", async () => {
      const { channel, sent, waits } = channelAnswering([
        throttle(),
        { StatusCode: 200, Payload: Buffer.from("ok") },
      ]);

      const result = await channel.invoke({ functionArn: ARN, payload: "{}" });

      expect(result).toEqual({ statusCode: 200, functionError: undefined, payload: "ok" });
      expect(sent).toHaveLength(2);
      expect(waits).toEqual([500]);
    });

    it("gives up after six attempts", async () => {
      const { channel, sent } = channelAnswering([throttle()]);

      await expect(channel.invoke({ functionArn: ARN, payload: "{}" })).rejects.toThrow(
        "Rate Exceeded.",
      );
      expect(sent).toHaveLength(6);
    });
  });

  describe("when the caller passes a signal", () => {
    /** @scenario "A cancelled turn stops the call on the Lambda lane" */
    it("hands it to the SDK as the invoke's abort signal", async () => {
      const { channel, sent } = channelAnswering([{ StatusCode: 200 }]);
      const signal = new AbortController().signal;

      await channel.invoke({ functionArn: ARN, payload: "{}", signal });

      expect(sent[0]?.abortSignal).toBe(signal);
    });
  });
});
