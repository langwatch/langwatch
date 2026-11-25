/**
 * The PII redaction model's Lambda alias, invoked directly. The function runs the Presidio
 * route behind the Lambda Web Adapter, so the request is an HTTP event and the answer opens
 * with a status prelude. Anything but a framed 2xx with one result per text is a refusal.
 */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { readLwaResponsePayload } from "@langwatch/aws-client";
import {
  LangevalsPiiDetectionError,
  type PiiDetectionOutcome,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";

import {
  PII_DETECTION_PATH,
  presidioDetectionBody,
  readPresidioDetectionAnswer,
} from "../rules/presidio-exchange.rules.ts";
import type { PresidioChannel } from "./presidio.channel.ts";

export class AwsPiiRedactionModelChannel implements PresidioChannel {
  /** `lambda` must be built with `maxAttempts: 1`: a failed call falls back, it is not re-run. */
  static create(input: {
    lambda: Pick<LambdaClient, "send">;
    functionArn: string;
  }): AwsPiiRedactionModelChannel {
    return new AwsPiiRedactionModelChannel(input.lambda, input.functionArn);
  }

  private constructor(
    private readonly lambda: Pick<LambdaClient, "send">,
    private readonly functionArn: string,
  ) {}

  async detect(input: PiiDetectionRequest): Promise<PiiDetectionOutcome> {
    if (input.texts.length === 0) return { kind: "detected", results: [] };

    const payload = JSON.stringify({
      rawPath: PII_DETECTION_PATH,
      requestContext: { http: { method: "POST" } },
      headers: { "content-type": "application/json" },
      body: presidioDetectionBody(input),
    });

    const response = await this.lambda.send(
      new InvokeCommand({
        FunctionName: this.functionArn,
        InvocationType: "RequestResponse",
        Payload: payload,
      }),
      { abortSignal: input.signal },
    );
    if (response.FunctionError) {
      throw new LangevalsPiiDetectionError(
        `PII redaction model failed with ${response.FunctionError}`,
      );
    }

    const { status, body } = readLwaResponsePayload(response.Payload);
    if (status === null) {
      throw new LangevalsPiiDetectionError("PII redaction model answered with no status prelude");
    }
    if (status < 200 || status >= 300) {
      throw new LangevalsPiiDetectionError(`PII redaction model answered ${status}`);
    }

    return {
      kind: "detected",
      results: readPresidioDetectionAnswer({
        answer: parsedJson(body),
        expected: input.texts.length,
      }),
    };
  }
}

function parsedJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new LangevalsPiiDetectionError(
      "PII redaction model answered with a body that is not JSON",
    );
  }
}
