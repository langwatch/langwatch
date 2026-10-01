import { generateText } from "ai";

import { handleForParameters } from "../../rules/execution-handle.rules.ts";
import {
  ModelProviderConnectionPing,
  type ModelProviderPingReply,
  type ModelProviderPingRequest,
} from "../model-provider-connection-ping.channel.ts";

const PING_BUDGET_MS = 20_000;
const PING_PROMPT = "ping";

/** One token down the execution proxy the product generates through at runtime. */
export class HttpModelProviderConnectionPingChannel extends ModelProviderConnectionPing {
  private constructor(private readonly executionProxyBaseUrl: string) {
    super();
  }

  static create({
    executionProxyBaseUrl,
  }: {
    executionProxyBaseUrl: string;
  }): HttpModelProviderConnectionPingChannel {
    return new HttpModelProviderConnectionPingChannel(executionProxyBaseUrl);
  }

  async ping({
    providerKey,
    model,
    parameters,
  }: ModelProviderPingRequest): Promise<ModelProviderPingReply> {
    try {
      await generateText({
        model: handleForParameters({
          providerKey,
          model,
          parameters,
          executionProxyBaseUrl: this.executionProxyBaseUrl,
        }),
        prompt: PING_PROMPT,
        maxOutputTokens: 1,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(PING_BUDGET_MS),
      });
      return { outcome: "generated" };
    } catch (error) {
      return this.failureOf(error);
    }
  }

  private failureOf(error: unknown): ModelProviderPingReply {
    const status =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const responseBody =
      error instanceof Error && "responseBody" in error && typeof error.responseBody === "string"
        ? error.responseBody
        : "";
    let message = "";
    if (error instanceof Error) message = error.message;
    else if (typeof error === "string") message = error;
    const thrownAs = error instanceof Error && error.name ? error.name : typeof error;
    return { outcome: "failed", status, message, responseBody, thrownAs };
  }
}
