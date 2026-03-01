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

import { createLogger } from "~/utils/logger/server";
import type { NormalizedEvent } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./_constants";
import {
  extractOutputMessages,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "./_extraction";
import { safeJsonParse } from "./_guards";
import { extractSystemInstructionFromMessages } from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

const logger = createLogger("langwatch:trace-processing:strands-extractor");

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
    if (candidate === undefined || candidate === null) continue;

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
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      const obj = parsed as Record<string, unknown>;
      if (obj.text && typeof obj.text === "string") {
        return obj.text;
      }
      if (obj.content !== undefined) {
        return obj.content;
      }
    }
  }

  return undefined;
};

export class StrandsExtractor implements CanonicalAttributesExtractor {
  readonly id = "strands";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // Multiple indicators for Strands SDK
    // ─────────────────────────────────────────────────────────────────────────
    const scopeName = ctx.span.instrumentationScope?.name;
    const isStrands =
      scopeName === "strands.telemetry.tracer" ||
      scopeName === "opentelemetry.instrumentation.strands" ||
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SYSTEM_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SERVICE_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.GEN_AI_AGENT_NAME) === "Strands Agents";

    if (!isStrands) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type
    // Strands spans are typically LLM spans
    // ─────────────────────────────────────────────────────────────────────────
    const operationName = attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    if (operationName && typeof operationName === "string") {
      const proposedSpanType = OPERATION_NAMES_SPAN_TYPE_MAP[operationName];
      if (proposedSpanType) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
        ctx.recordRule(`${this.id}:gen_ai.operation_name->langwatch.span.type`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages from Events
    // Strands uses separate events for each message role:
    // - gen_ai.system.message
    // - gen_ai.user.message
    // - gen_ai.assistant.message
    // - gen_ai.tool.message
    // Note: Cannot use extractInputMessages() helper as it doesn't support
    // multiple event types with different role inference
    // ─────────────────────────────────────────────────────────────────────────
    if (!ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const inputMessages: unknown[] = [];

      for (const eventName of ROLE_EVENT_NAMES) {
        const events = ctx.bag.events.takeAll(eventName);
        for (const event of events) {
          // Infer role from event name (e.g., "gen_ai.user.message" → "user")
          const role = eventName.split(".")[1];
          const eventAttrs = (event.attributes ?? {}) as Record<
            string,
            unknown
          >;

          // Debug: log event attributes to understand the structure
          logger.debug(
            {
              eventName,
              role,
              eventAttrs: JSON.stringify(eventAttrs),
              attrKeys: Object.keys(eventAttrs),
            },
            "Processing Strands input event",
          );

          const content = extractStrandsContent(eventAttrs);

          if (content !== void 0) {
            inputMessages.push({ role, content });
            logger.debug(
              {
                role,
                contentType: typeof content,
                contentPreview: JSON.stringify(content).slice(0, 100),
              },
              "Extracted Strands input message",
            );
          }
        }
      }

      if (inputMessages.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, inputMessages);
        ctx.recordRule(`${this.id}:events->gen_ai.input.messages`);
        recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");

        // Extract system instruction from assembled messages
        const sysInstruction = extractSystemInstructionFromMessages(inputMessages);
        if (sysInstruction !== null) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
            sysInstruction,
          );
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages from gen_ai.choice Events
    // ─────────────────────────────────────────────────────────────────────────
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

            // Debug: log event attributes
            logger.debug(
              {
                eventAttrs: JSON.stringify(eventAttrs),
                attrKeys: Object.keys(eventAttrs),
              },
              "Processing Strands output event",
            );

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

    // ─────────────────────────────────────────────────────────────────────────
    // Model (passthrough signal)
    // Models may appear as attributes; just record that we matched
    // ─────────────────────────────────────────────────────────────────────────
    const model =
      attrs.get(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ??
      attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
    if (typeof model === "string" && model.length > 0) {
      ctx.recordRule(`${this.id}:matched`);
    }
  }
}
