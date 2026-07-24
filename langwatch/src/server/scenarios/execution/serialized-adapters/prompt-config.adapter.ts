/**
 * Serialized prompt config adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { generateText } from "ai";
import { Liquid } from "liquidjs";
import { createModelFromParams } from "../model.factory";
import type { LiteLLMParams, PromptConfigData } from "../types";

// Shared Liquid engine instance for template interpolation
const liquid = new Liquid();

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
   * Check if the template (system prompt or any message) uses the messages variable.
   * If so, the template handles conversation history placement.
   */
  private templateContainsMessages(): boolean {
    const messagesPattern = /\bmessages\b/;
    if (messagesPattern.test(this.config.systemPrompt)) {
      return true;
    }
    return this.config.messages.some((m) => messagesPattern.test(m.content));
  }
}
