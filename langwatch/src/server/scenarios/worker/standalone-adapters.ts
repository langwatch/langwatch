/**
 * Standalone adapters for scenario worker execution.
 *
 * These adapters operate with pre-fetched configuration data and don't require
 * database access. They're designed to run in isolated worker threads.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { generateText } from "ai";
import { JSONPath } from "jsonpath-plus";
import type {
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
} from "./types";

/**
 * Creates a Vercel AI model using pre-fetched LiteLLM params.
 */
function createModelFromParams(
  litellmParams: LiteLLMParams,
  nlpServiceUrl: string,
) {
  const providerKey = litellmParams.model.split("/")[0];
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAICompatible({
    name: providerKey ?? "unknown",
    apiKey: litellmParams.api_key,
    baseURL: `${nlpServiceUrl}/proxy/v1`,
    headers,
  });

  return vercelProvider(litellmParams.model);
}

/**
 * Standalone prompt config adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class StandalonePromptConfigAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly config: PromptConfigData,
    private readonly litellmParams: LiteLLMParams,
    private readonly nlpServiceUrl: string,
  ) {
    super();
    this.name = "StandalonePromptConfigAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    // Build messages: system prompt + prompt messages + conversation history
    const messages = [
      { role: "system" as const, content: this.config.systemPrompt },
      ...this.config.messages,
      ...input.messages,
    ];

    // Create model from pre-fetched params
    const model = createModelFromParams(this.litellmParams, this.nlpServiceUrl);

    // Generate response using Vercel AI SDK
    const result = await generateText({
      model,
      messages,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    });

    return result.text;
  }
}

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

type AuthStrategy = (auth: HttpAgentData["auth"]) => Record<string, string>;

const emptyHeaders: Record<string, string> = {};

const AUTH_STRATEGIES: Record<string, AuthStrategy> = {
  none: () => emptyHeaders,
  bearer: (auth) => {
    if (auth?.type !== "bearer" || !auth.token) return emptyHeaders;
    return { Authorization: `Bearer ${auth.token}` };
  },
  api_key: (auth) => {
    if (auth?.type !== "api_key" || !auth.header || !auth.value)
      return emptyHeaders;
    return { [auth.header]: auth.value };
  },
  basic: (auth) => {
    if (auth?.type !== "basic" || !auth.username) return emptyHeaders;
    const credentials = Buffer.from(
      `${auth.username}:${auth.password ?? ""}`,
    ).toString("base64");
    return { Authorization: `Basic ${credentials}` };
  },
};

/**
 * Standalone HTTP agent adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class StandaloneHttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(private readonly config: HttpAgentData) {
    super();
    this.name = "StandaloneHttpAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const headers = this.buildRequestHeaders();
    const body = this.buildRequestBody(input);
    const responseData = await this.executeHttpRequest(headers, body);
    return this.extractResponseContent(responseData);
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Apply custom headers
    for (const header of this.config.headers) {
      const key = header.key.trim();
      if (key) {
        headers[key] = header.value;
      }
    }

    // Apply authentication
    if (this.config.auth) {
      const strategy = AUTH_STRATEGIES[this.config.auth.type];
      if (strategy) {
        Object.assign(headers, strategy(this.config.auth));
      }
    }

    return headers;
  }

  private async executeHttpRequest(
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const response = await fetch(this.config.url, {
      method: this.config.method,
      headers,
      body: this.config.method !== "GET" ? body : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  private extractResponseContent(data: unknown): string {
    if (!this.config.outputPath?.trim() || !data) {
      return this.stringify(data);
    }

    try {
      const extracted = JSONPath({ path: this.config.outputPath, json: data });
      if (!extracted?.length) {
        return this.stringify(data);
      }
      return this.stringify(extracted[0]);
    } catch {
      return this.stringify(data);
    }
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private buildRequestBody(input: AgentInput): string {
    if (!this.config.bodyTemplate) {
      return JSON.stringify({ messages: input.messages });
    }

    let body = this.config.bodyTemplate;

    body = body.replace(
      /\{\{\s*messages\s*\}\}/g,
      JSON.stringify(input.messages),
    );

    body = body.replace(
      /\{\{\s*threadId\s*\}\}/g,
      input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    );

    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    if (lastUserMessage) {
      body = body.replace(
        /\{\{\s*input\s*\}\}/g,
        typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content),
      );
    }

    return body;
  }
}
