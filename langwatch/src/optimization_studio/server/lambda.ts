import {
  LambdaClient,
  InvokeWithResponseStreamCommand,
} from "@aws-sdk/client-lambda";
import type { StudioClientEvent } from "../types/events";
import * as Sentry from "@sentry/node";

export const invokeLambda = async (
  event: StudioClientEvent,
  s3CacheKey: string | undefined
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const payload = {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
      ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
    },
  };

  if (process.env.LANGWATCH_NLP_SERVICE_INVOKE_ARN) {
    const arn = process.env.LANGWATCH_NLP_SERVICE_INVOKE_ARN;
    const region =
      process.env.AWS_REGION ??
      arn.replace(/^arn:aws:lambda:([^:]+):.*$/, "$1");
    const lambda = new LambdaClient({ region });

    const command = new InvokeWithResponseStreamCommand({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({
        rawPath: "/studio/execute",
        requestContext: {
          http: {
            method: "POST",
          },
        },
        ...payload,
      }),
    });

    const { EventStream } = await lambda.send(command);

    if (!EventStream) {
      throw new Error("No payload received from Lambda");
    }

    const webStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of EventStream) {
            if (chunk.PayloadChunk?.Payload) {
              controller.enqueue(chunk.PayloadChunk.Payload);
            }
            if (chunk.InvokeComplete?.ErrorCode) {
              const error = new Error(
                `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`
              );
              Sentry.captureException(error, {
                extra: { event, details: chunk.InvokeComplete.ErrorDetails },
              });
              throw error;
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return webStream.getReader();
  } else {
    const response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute`,
      {
        method: "POST",
        ...payload,
      }
    );

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(body, null, 2);
      } catch {}
      if (response.status === 422) {
        console.error(
          "Optimization Studio validation failed, some components might be outdated",
          "\n\n",
          JSON.stringify(event, null, 2)
        );
        const error = new Error(
          `Optimization Studio validation failed, some components might be outdated`
        );
        Sentry.captureException(error, { extra: { event } });
        throw error;
      }
      throw new Error(`Failed run workflow: ${response.statusText}\n\n${body}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    return response.body.getReader();
  }
};
