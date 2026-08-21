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
import type { RunParameterValues } from "../../parameters";
import { createChildProcessLogger } from "../child-logger";
import { createModelFromParams } from "../model.factory";
import {
  buildPromptTemplateContext,
  templateReferencesConversation,
} from "../prompt-template-context";
import type { LiteLLMParams, PromptConfigData } from "../types";

// Shared Liquid engine instance for template interpolation
const liquid = new Liquid();

/**
 * Serialized prompt config adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedPromptConfigAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly logger: Logger;

  private readonly config: PromptConfigData;
  private readonly litellmParams: LiteLLMParams;
  private readonly nlpServiceUrl: string;
  private readonly parameters: RunParameterValues;

  constructor(options: {
    config: PromptConfigData;
    litellmParams: LiteLLMParams;
    nlpServiceUrl: string;
    logger?: Logger;
    /** The run's resolved values, read from the template as `params.NAME`. */
    parameters?: RunParameterValues;
  }) {
    super();
    this.name = "SerializedPromptConfigAdapter";
    this.config = options.config;
    this.litellmParams = options.litellmParams;
    this.nlpServiceUrl = options.nlpServiceUrl;
    this.parameters = options.parameters ?? {};
    this.logger =
      options.logger ??
      createChildProcessLogger("langwatch:scenarios:prompt-adapter");
  }

  async call(input: AgentInput): Promise<string> {
    const { context: templateContext, unboundInputs } =
      buildPromptTemplateContext({
        input,
        inputs: this.config.inputs,
        scenarioMappings: this.config.scenarioMappings,
        parameters: this.parameters,
      });

    if (unboundInputs.length > 0) {
      this.reportUnboundInputs(unboundInputs);
    }

    // A template that reads the conversation places the history itself, so
    // appending it again would show the model the same turns twice.
    const templateUsesConversation = this.templateReadsConversation();

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
      ...(templateUsesConversation ? [] : input.messages),
    ];

    const model = createModelFromParams({
      litellmParams: this.litellmParams,
      nlpServiceUrl: this.nlpServiceUrl,
    });

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
   * history itself, in either the prose or the structured form.
   *
   * ⚠ This used to test `/\bmessages\b/` against the raw template text, so a
   * system prompt containing the ordinary word "messages" in prose dropped the
   * conversation history from the request entirely; and it knew only the prose
   * binding, so a template reading the structured one was shown every prior
   * turn twice.
   */
  private templateReadsConversation(): boolean {
    if (templateReferencesConversation(this.config.systemPrompt)) return true;
    return this.config.messages.some((m) =>
      templateReferencesConversation(m.content),
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
