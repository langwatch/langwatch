/**
 * The AWS half of a streaming studio invoke: `InvokeWithResponseStream`, whose
 * event stream is handed on frame by frame. Nothing here reads the framing —
 * the Lambda Web Adapter prelude and the SSE body are the caller's business.
 */
import { InvokeWithResponseStreamCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import {
  NlpLambdaStreamInvoke,
  type NlpLambdaStreamChunk,
} from "../app/workflow.app.ts";

export class AwsNlpLambdaStreamInvokeAdapter implements NlpLambdaStreamInvoke {
  static create(options: { lambda: LambdaClient }): AwsNlpLambdaStreamInvokeAdapter {
    return new AwsNlpLambdaStreamInvokeAdapter(options.lambda);
  }

  private constructor(private readonly lambda: LambdaClient) {
  }

  async invokeStream(input: {
    functionArn: string;
    payload: string;
    signal?: AbortSignal | undefined;
  }): Promise<AsyncIterable<NlpLambdaStreamChunk>> {
    const { EventStream } = await this.lambda.send(
      new InvokeWithResponseStreamCommand({
        FunctionName: input.functionArn,
        InvocationType: "RequestResponse",
        Payload: input.payload,
      }),
      input.signal ? { abortSignal: input.signal } : {},
    );

    if (!EventStream) {
      throw new Error("The NLP Lambda answered the studio invoke with no event stream.");
    }

    return frames(EventStream);
  }
}

async function* frames(
  stream: AsyncIterable<{
    PayloadChunk?: { Payload?: Uint8Array<ArrayBufferLike> | undefined } | undefined;
    InvokeComplete?: { ErrorCode?: string | undefined; ErrorDetails?: string | undefined };
  }>,
): AsyncIterable<NlpLambdaStreamChunk> {
  for await (const event of stream) {
    const bytes = event.PayloadChunk?.Payload;
    if (bytes) {
      yield { kind: "payload", bytes };
    }

    const errorCode = event.InvokeComplete?.ErrorCode;
    if (errorCode) {
      yield { kind: "failed", errorCode, details: event.InvokeComplete?.ErrorDetails };
    }
  }
}
