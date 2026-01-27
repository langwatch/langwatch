/**
 * Serialized adapters for scenario worker execution.
 *
 * These adapters operate with pre-fetched configuration data and don't require
 * database access. They're designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { generateText } from "ai";
import { JSONPath } from "jsonpath-plus";
import { Liquid } from "liquidjs";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../adapters/auth.strategies";
import { createModelFromParams } from "./model.factory";
import type { HttpAgentData, LiteLLMParams, PromptConfigData } from "./types";

// Shared Liquid engine instance for template interpolation
const liquid = new Liquid();

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

/**
 * Serialized prompt config adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedPromptConfigAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    private readonly config: PromptConfigData,
    private readonly litellmParams: LiteLLMParams,
    private readonly nlpServiceUrl: string,
  ) {
    super();
    this.name = "SerializedPromptConfigAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    // Build template context for Liquid
    // Note: messages is serialized to JSON string for template interpolation
    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    const templateContext = {
      input:
        typeof lastUserMessage?.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage?.content ?? ""),
      messages: JSON.stringify(input.messages),
    };

    // Check if template uses {{messages}} - if so, template handles conversation history
    const templateUsesMessages = this.templateContainsMessages();

    // Interpolate template variables using Liquid
    const systemPrompt = await liquid.parseAndRender(
      this.config.systemPrompt,
      templateContext,
    );

    const promptMessages = await Promise.all(
      this.config.messages.map(async (m) => ({
        role: m.role as "user" | "assistant",
        content: await liquid.parseAndRender(m.content, templateContext),
      })),
    );

    // Build messages: system + template messages + conversation history (if not handled by template)
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...promptMessages,
      // Only append input.messages if template doesn't use {{messages}}
      ...(templateUsesMessages ? [] : input.messages),
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

  /**
   * Check if the template (system prompt or any message) contains {{messages}}.
   * If so, the template handles conversation history placement.
   */
  private templateContainsMessages(): boolean {
    const messagesPattern = /\{\{\s*messages\s*\}\}/;
    if (messagesPattern.test(this.config.systemPrompt)) {
      return true;
    }
    return this.config.messages.some((m) => messagesPattern.test(m.content));
  }
}

/**
 * Serialized HTTP agent adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedHttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(private readonly config: HttpAgentData) {
    super();
    this.name = "SerializedHttpAgentAdapter";
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
    const method = this.config.method.toUpperCase();
    const response = await ssrfSafeFetch(this.config.url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
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

    // Build template context for Liquid (matching prompt adapter pattern)
    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    const templateContext = {
      messages: JSON.stringify(input.messages),
      threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
      input:
        typeof lastUserMessage?.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage?.content ?? ""),
    };

    return liquid.parseAndRenderSync(this.config.bodyTemplate, templateContext);
  }
}
