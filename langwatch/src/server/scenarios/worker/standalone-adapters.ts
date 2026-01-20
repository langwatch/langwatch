/**
 * Standalone adapters for scenario worker execution.
 *
 * These adapters operate with pre-fetched configuration data and don't require
 * database access. They're designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { generateText } from "ai";
import { JSONPath } from "jsonpath-plus";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../adapters/auth-strategies";
import { createModelFromParams } from "./model-factory";
import type { HttpAgentData, LiteLLMParams, PromptConfigData } from "./types";

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

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
    const messages = [
      { role: "system" as const, content: this.config.systemPrompt },
      ...this.config.messages,
      ...input.messages,
    ];

    const model = createModelFromParams(this.litellmParams, this.nlpServiceUrl);

    const result = await generateText({
      model,
      messages,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    });

    return result.text;
  }
}

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

    for (const header of this.config.headers) {
      const key = header.key.trim();
      if (key) {
        headers[key] = header.value;
      }
    }

    Object.assign(headers, applyAuthentication(this.config.auth));

    return headers;
  }

  private async executeHttpRequest(
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const response = await ssrfSafeFetch(this.config.url, {
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
