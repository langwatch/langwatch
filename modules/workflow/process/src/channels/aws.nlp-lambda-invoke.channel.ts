/**
 * The AWS half of a synchronous engine invoke: one `Invoke`, answered whole, sent again only
 * when the failure proves the function never started. Its client is built with one SDK attempt.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";

import {
  invokeNeverStarted,
  invokeRetryDelayMs,
  NLP_INVOKE_MAX_ATTEMPTS,
} from "../rules/nlp-lambda-invoke-retry.rules.ts";
import { type NlpLambdaInvoke, type NlpLambdaInvokeResult } from "./nlp-lambda.channel.ts";

const logger = createLogger("langwatch:workflow:nlp-lambda-invoke");

/** Resolves after `ms`, or rejects with the signal's reason once it aborts. */
function waitBeforeRetry({ ms, signal }: { ms: number; signal?: AbortSignal | undefined }) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AwsNlpLambdaInvokeChannel implements NlpLambdaInvoke {
  /** `lambda` must be built with `maxAttempts: 1`: the SDK's retry re-runs a started function. */
  static create(options: {
    lambda: LambdaClient;
    /** Injected so a test does not wait out the backoff. */
    wait?: typeof waitBeforeRetry;
  }): AwsNlpLambdaInvokeChannel {
    return new AwsNlpLambdaInvokeChannel(options.lambda, options.wait ?? waitBeforeRetry);
  }

  private constructor(
    private readonly lambda: LambdaClient,
    private readonly wait: typeof waitBeforeRetry,
  ) {}

  async invoke(input: {
    functionArn: string;
    payload: string;
    signal?: AbortSignal | undefined;
  }): Promise<NlpLambdaInvokeResult> {
    const command = new InvokeCommand({
      FunctionName: input.functionArn,
      InvocationType: "RequestResponse",
      Payload: input.payload,
    });

    let refusal: unknown;
    for (let attempt = 1; attempt <= NLP_INVOKE_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.lambda.send(
          command,
          input.signal ? { abortSignal: input.signal } : {},
        );
        return {
          statusCode: response.StatusCode ?? 200,
          functionError: response.FunctionError,
          payload: response.Payload ? Buffer.from(response.Payload).toString("utf-8") : "",
        };
      } catch (error) {
        if (!invokeNeverStarted(error)) throw error;
        refusal = error;
        if (attempt === NLP_INVOKE_MAX_ATTEMPTS) break;
        logger.warn(
          { attempt, error: (error as { name?: string } | null)?.name },
          "nlpgo invoke refused before the function started, retrying",
        );
        await this.wait({ ms: invokeRetryDelayMs(attempt), signal: input.signal });
      }
    }
    throw refusal;
  }
}
