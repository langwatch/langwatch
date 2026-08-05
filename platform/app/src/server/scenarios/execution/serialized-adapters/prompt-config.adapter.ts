/**
 * Serialized prompt config adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { Logger } from "@langwatch/observability";
import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { trace } from "@opentelemetry/api";
import { generateText } from "ai";
import { Liquid } from "liquidjs";
import { createChildProcessLogger } from "../child-logger";
import { createModelFromParams } from "../model.factory";
import {
  buildPromptTemplateContext,
  templateReferencesVariable,
} from "../prompt-template-context";
import type { LiteLLMParams, PromptConfigData } from "../types";

// Shared Liquid engine instance for template interpolation
const liquid = new Liquid();

/** The context name a template reads to place conversation history itself. */
const MESSAGES_VARIABLE = "messages";

/**
 * Serialized prompt config adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedPromptConfigAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly logger: Logger;

  constructor(
    private readonly config: PromptConfigData,
    private readonly litellmParams: LiteLLMParams,
    private readonly nlpServiceUrl: string,
    logger?: Logger,
  ) {
    super();
    this.name = "SerializedPromptConfigAdapter";
    this.logger =
      logger ?? createChildProcessLogger("langwatch:scenarios:prompt-adapter");
  }

  async call(input: AgentInput): Promise<string> {
    const { context: templateContext, unboundInputs } =
      buildPromptTemplateContext({
        input,
        inputs: this.config.inputs,
        scenarioMappings: this.config.scenarioMappings,
      });

    if (unboundInputs.length > 0) {
      this.reportUnboundInputs(unboundInputs);
    }

    // A template that reads `messages` places the conversation history itself,
    // so appending it again would show the model the same turns twice.
    const templateUsesMessages = this.templateReadsMessages();

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
      // Only append input.messages if the template doesn't place them itself
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
   * Whether the template (system prompt or any message) reads the conversation
   * history itself.
   *
   * ⚠ This used to test `/\bmessages\b/` against the raw template text, so a
   * system prompt containing the ordinary word "messages" in prose dropped the
   * conversation history from the request entirely.
   */
  private templateReadsMessages(): boolean {
    if (templateReferencesVariable(this.config.systemPrompt, MESSAGES_VARIABLE))
      return true;
    return this.config.messages.some((m) =>
      templateReferencesVariable(m.content, MESSAGES_VARIABLE),
    );
  }

  /**
   * Record the declared inputs a simulation has nothing to bind to.
   *
   * The rendered prompt already shows a placeholder where each one would have
   * gone; this puts the same list on the run's trace and in the worker log, so
   * the cause is findable from the run rather than only from reading the
   * prompt. The values themselves are never recorded — only the names.
   */
  private reportUnboundInputs(unboundInputs: string[]): void {
    trace.getActiveSpan()?.addEvent("langwatch.prompt.unbound_inputs", {
      "langwatch.prompt.id": this.config.promptId,
      "langwatch.prompt.unbound_inputs": unboundInputs.join(", "),
    });
    this.logger.warn(
      { promptId: this.config.promptId, unboundInputs },
      "Prompt declares input variables a simulation cannot bind",
    );
  }
}
