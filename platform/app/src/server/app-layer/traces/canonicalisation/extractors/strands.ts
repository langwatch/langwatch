/**
 * Strands Agents Extractor
 *
 * Handles: Strands Agents SDK telemetry
 * Reference: https://github.com/strands-agents/strands
 *
 * Strands uses OpenTelemetry events for message passing rather than attributes.
 * Input messages come from gen_ai.{role}.message events, output from gen_ai.choice.
 *
 * Detection: Instrumentation scope name contains 'strands' or system/service
 * indicators point to strands-agents
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from gen_ai.operation.name attribute)
 * - gen_ai.input.messages (from gen_ai.*.message events)
 * - gen_ai.output.messages (from gen_ai.choice events)
 */

import type { NormalizedEvent } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./_constants";
import { extractOutputMessages, recordValueType } from "./_extraction";
import { safeJsonParse } from "./_guards";
import {
  extractSystemInstructionFromMessages,
  stripSystemMessages,
} from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

/**
 * Event names for role-based input messages.
 * Strands emits separate events for each message role.
 */
const ROLE_EVENT_NAMES = [
  "gen_ai.system.message",
  "gen_ai.user.message",
  "gen_ai.assistant.message",
  "gen_ai.tool.message",
] as const satisfies readonly string[];

const OPERATION_NAMES_SPAN_TYPE_MAP: Record<string, string> = {
  chat: "llm",
  execute_tool: "tool",
  invoke_agent: "agent",
};

/**
 * Extracts content from Strands event attributes.
 * Strands can send content in various formats:
 * - Direct string content
 * - Array of content parts: [{ text: "..." }]
 * - Nested in gen_ai.content attribute
 */
// Text or content field of an object-shaped candidate, once parsed.
const textOrContentFromStrandsObject = (
  obj: Record<string, unknown>,
): unknown => {
  if (obj.text && typeof obj.text === "string") return obj.text;
  if (obj.content !== undefined) return obj.content;
  return undefined;
};

const resolveStrandsCandidateContent = (candidate: unknown): unknown => {
  if (candidate === undefined || candidate === null) return undefined;

  // Parse JSON string if needed
  const parsed = safeJsonParse(candidate);

  // If it's a non-empty string, use it
  if (typeof parsed === "string" && parsed.trim().length > 0) {
    return parsed;
  }

  // If it's a non-empty array, use it
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed;
  }

  // If it's an object with content, extract it
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return textOrContentFromStrandsObject(parsed as Record<string, unknown>);
  }

  return undefined;
};

/**
 * Extracts content from Strands event attributes.
 * Strands can send content in various formats:
 * - Direct string content
 * - Array of content parts: [{ text: "..." }]
 * - Nested in gen_ai.content attribute
 */
const extractStrandsContent = (
  eventAttrs: Record<string, unknown>,
): unknown => {
  // Try various content attribute names
  const contentCandidates = [
    eventAttrs.content,
    eventAttrs["gen_ai.content"],
    eventAttrs.message,
    eventAttrs.text,
    eventAttrs["gen_ai.prompt.content"],
  ];

  for (const candidate of contentCandidates) {
    const resolved = resolveStrandsCandidateContent(candidate);
    if (resolved !== undefined) return resolved;
  }

  return undefined;
};

export class StrandsExtractor implements CanonicalAttributesExtractor {
  readonly id = "strands";

  // Multiple indicators for Strands SDK
  private isStrandsSpan(ctx: ExtractorContext): boolean {
    const { attrs } = ctx.bag;
    const scopeName = ctx.span.instrumentationScope?.name;
    return (
      scopeName === "strands.telemetry.tracer" ||
      scopeName === "opentelemetry.instrumentation.strands" ||
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SYSTEM_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SERVICE_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.GEN_AI_AGENT_NAME) === "Strands Agents"
    );
  }

  // Strands spans are typically LLM spans
  private setSpanTypeFromOperation(ctx: ExtractorContext): void {
    const operationName = ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    if (!operationName || typeof operationName !== "string") return;
    const proposedSpanType = OPERATION_NAMES_SPAN_TYPE_MAP[operationName];
    if (proposedSpanType) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
      ctx.recordRule(`${this.id}:gen_ai.operation_name->langwatch.span.type`);
    }
  }

  // Take all role-based events in their original array order to preserve
  // conversation interleaving (user, assistant, user, assistant, ...).
  // Previously iterating by role name grouped all messages of the same
  // role together, destroying chronological order.
  private collectInputMessagesFromEvents(ctx: ExtractorContext): unknown[] {
    const inputMessages: unknown[] = [];
    const roleEvents = ctx.bag.events.takeAllByNames(ROLE_EVENT_NAMES);
    for (const event of roleEvents) {
      // Infer role from event name (e.g., "gen_ai.user.message" → "user")
      const role = event.name.split(".")[1];
      const eventAttrs = (event.attributes ?? {}) as Record<string, unknown>;

      const content = extractStrandsContent(eventAttrs);

      if (content !== void 0) {
        inputMessages.push({ role, content });
      }
    }
    return inputMessages;
  }

  private applySystemInstructionFromMessages(
    ctx: ExtractorContext,
    inputMessages: unknown[],
  ): void {
    const systemOnly = inputMessages.filter(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).role === "system",
    );
    if (systemOnly.length === 0) return;

    const sysInstruction = extractSystemInstructionFromMessages(systemOnly);
    if (sysInstruction !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
    }
  }

  // Strands uses separate events for each message role:
  // - gen_ai.system.message
  // - gen_ai.user.message
  // - gen_ai.assistant.message
  // - gen_ai.tool.message
  // Note: Cannot use extractInputMessages() helper as it doesn't support
  // multiple event types with different role inference
  private liftInputMessagesFromEvents(ctx: ExtractorContext): void {
    if (ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) return;

    const inputMessages = this.collectInputMessagesFromEvents(ctx);
    if (inputMessages.length === 0) return;

    // Always strip system messages — they are promoted to gen_ai.system_instructions.
    // Filter to system-only first so extractSystemInstructionFromMessages sees
    // the system message at position 0 regardless of where it appeared chronologically.
    const chatMessages = stripSystemMessages(inputMessages);
    this.applySystemInstructionFromMessages(ctx, inputMessages);

    if (chatMessages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMessages);
      ctx.recordRule(`${this.id}:events->gen_ai.input.messages`);
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }
  }

  private liftOutputMessagesFromChoiceEvents(ctx: ExtractorContext): void {
    const outputExtracted = extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (event: NormalizedEvent) => {
            const eventAttrs = (event.attributes ?? {}) as Record<
              string,
              unknown
            >;

            const content = extractStrandsContent(eventAttrs);
            const role = (eventAttrs.role as string | undefined) ?? "assistant";

            if (content !== undefined) {
              return {
                role,
                content,
                finish_reason: eventAttrs.finish_reason,
              };
            }
            return undefined;
          },
        },
      ],
      `${this.id}:gen_ai.choice->gen_ai.output.messages`,
    );

    if (outputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }
  }

  // Models may appear as attributes; just record that we matched
  private recordModelMatch(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const model =
      attrs.get(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ??
      attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
    if (typeof model === "string" && model.length > 0) {
      ctx.recordRule(`${this.id}:matched`);
    }
  }

  apply(ctx: ExtractorContext): void {
    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // ─────────────────────────────────────────────────────────────────────────
    if (!this.isStrandsSpan(ctx)) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type
    // ─────────────────────────────────────────────────────────────────────────
    this.setSpanTypeFromOperation(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages from Events
    // ─────────────────────────────────────────────────────────────────────────
    this.liftInputMessagesFromEvents(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages from gen_ai.choice Events
    // ─────────────────────────────────────────────────────────────────────────
    this.liftOutputMessagesFromChoiceEvents(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Model (passthrough signal)
    // ─────────────────────────────────────────────────────────────────────────
    this.recordModelMatch(ctx);
  }
}
