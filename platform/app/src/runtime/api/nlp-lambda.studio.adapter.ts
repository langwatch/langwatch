import { createLogger } from "@langwatch/observability";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { z } from "zod";
import type { NlpLambdaRuntime } from "./nlp-lambda.runtime";

const logger = createLogger("langwatch:nlp-studio-lambda");
const responsePreludeSchema = z.object({ statusCode: z.coerce.number().int() });

export const LWA_PRELUDE_SEPARATOR_LEN = 8;

export type StudioNlpInvokeOptions = {
  path?: string;
  headers?: Record<string, string>;
  supportsStaging?: boolean;
};

function redactEventForErrorReporting(event: StudioClientEvent): unknown {
  if (!("workflow" in event.payload)) {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      workflow: {
        ...event.payload.workflow,
        secrets: "[REDACTED]",
      },
    },
  };
}

export function findLwaPreludeSeparator(buf: Uint8Array<ArrayBufferLike>): number {
  for (let index = 0; index + LWA_PRELUDE_SEPARATOR_LEN <= buf.length; index++) {
    let isSeparator = true;
    for (let offset = 0; offset < LWA_PRELUDE_SEPARATOR_LEN; offset++) {
      if (buf[index + offset] !== 0) {
        isSeparator = false;
        break;
      }
    }
    if (isSeparator) {
      return index;
    }
  }
  return -1;
}

export function concatBytes(
  first: Uint8Array<ArrayBufferLike>,
  second: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  return combined;
}

/**
 * Compatibility execution seam for the existing Studio post-event transport.
 * It preserves the current reader shape until that transport moves to Workflow.
 */
export async function invokeStudioNlp(
  runtime: NlpLambdaRuntime,
  projectId: string,
  event: StudioClientEvent,
  s3CacheKey: string | undefined,
  options: StudioNlpInvokeOptions = {},
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const path = options.path ?? "/studio/execute";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
    ...options.headers,
  };
  const payload = { body: JSON.stringify(event), headers };

  if (!runtime.usesLambda()) {
    return invokeStudioOverHttp({
      runtime,
      target: await runtime.resolveTarget(projectId),
      path,
      payload,
      event,
    });
  }

  return invokeStudioOverLambda({
    runtime,
    projectId,
    event,
    path,
    payload,
    supportsStaging: options.supportsStaging ?? false,
  });
}

async function invokeStudioOverLambda(input: {
  runtime: NlpLambdaRuntime;
  projectId: string;
  event: StudioClientEvent;
  path: string;
  payload: { body: string; headers: Record<string, string> };
  supportsStaging: boolean;
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await input.runtime.invokeResponseStream({
    projectId: input.projectId,
    path: input.path,
    headers: input.payload.headers,
    body: input.payload.body,
    supportsStaging: input.supportsStaging,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let statusCode = 200;
      let errorMessage = "";
      let preludeStripped = false;
      let preludeBuffer = new Uint8Array(0);

      try {
        for await (const chunk of response.eventStream) {
          const payload = chunk.PayloadChunk?.Payload;
          if (payload) {
            let payloadBytes = payload;
            if (!preludeStripped) {
              const merged = concatBytes(preludeBuffer, payloadBytes);
              const separatorIndex = findLwaPreludeSeparator(merged);
              if (separatorIndex === -1) {
                preludeBuffer = merged;
                continue;
              }
              try {
                const prelude = responsePreludeSchema.safeParse(
                  JSON.parse(new TextDecoder().decode(merged.slice(0, separatorIndex))),
                );
                if (prelude.success) {
                  statusCode = prelude.data.statusCode;
                }
              } catch {
                // Keep the legacy default when an adapter prelude is malformed.
              }
              payloadBytes = merged.slice(separatorIndex + LWA_PRELUDE_SEPARATOR_LEN);
              preludeStripped = true;
              preludeBuffer = new Uint8Array(0);
              if (payloadBytes.length === 0) {
                continue;
              }
            }

            if (statusCode < 200 || statusCode >= 300) {
              errorMessage += new TextDecoder().decode(payloadBytes);
            }
            controller.enqueue(payloadBytes);
          }

          if (chunk.InvokeComplete?.ErrorCode) {
            const error = new Error(
              `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`,
            );
            input.runtime.reportException(error, {
              event: redactEventForErrorReporting(input.event),
              details: chunk.InvokeComplete.ErrorDetails,
            });
            throw error;
          }
        }

        throwForStudioStatus({
          runtime: input.runtime,
          statusCode,
          errorMessage,
          event: input.event,
        });
        controller.close();
      } catch (error) {
        logger.error({ error }, "failed to run workflow stream");
        controller.error(error);
      } finally {
        await response.release();
      }
    },
  });

  return stream.getReader();
}

function throwForStudioStatus(input: {
  runtime: NlpLambdaRuntime;
  statusCode: number;
  errorMessage: string;
  event: StudioClientEvent;
}): void {
  if (input.statusCode >= 200 && input.statusCode < 300) {
    return;
  }

  let errorMessage = input.errorMessage;
  try {
    errorMessage = String(JSON.parse(errorMessage.trim()));
  } catch {
    // Responses may be plain text rather than JSON.
  }

  if (input.statusCode === 422) {
    logger.error(
      { event: redactEventForErrorReporting(input.event), errorMessage },
      "Optimization Studio validation failed, please contact support",
    );
    const error = new Error(
      "Optimization Studio validation failed, please contact support",
    );
    input.runtime.reportException(error, {
      event: redactEventForErrorReporting(input.event),
    });
    throw error;
  }

  throw new Error(`Failed run workflow: ${input.statusCode}\n\n${errorMessage}`);
}

async function invokeStudioOverHttp(input: {
  runtime: NlpLambdaRuntime;
  target: string;
  path: string;
  payload: { body: string; headers: Record<string, string> };
  event: StudioClientEvent;
}): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(`${input.target}${input.path}`, {
    method: "POST",
    ...input.payload,
  });

  if (!response.ok) {
    let body: unknown = await response.text();
    try {
      body = JSON.parse(String(body));
    } catch {
      // Responses may be plain text rather than JSON.
    }
    if (response.status === 422) {
      console.error(
        "Optimization Studio validation failed, please contact support",
        "\n\n",
        JSON.stringify(redactEventForErrorReporting(input.event), null, 2),
        "\n\nValidation error:\n",
        body,
      );
      const error = new Error(
        "Optimization Studio validation failed, please contact support",
      );
      input.runtime.reportException(error, {
        event: redactEventForErrorReporting(input.event),
      });
      throw error;
    }
    throw new Error(`Failed run workflow: ${response.statusText}\n\n${body}`);
  }

  if (response.body === null) {
    throw new Error("No response body");
  }
  return response.body.getReader();
}
