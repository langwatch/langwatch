/** Maps Strands' event-based messages and operation names to canonical keys. */

import type { CanonicalEvent } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import {
  extractOutputMessages,
  recordValueType,
} from "../services/canonical-extraction.service";
import { isRecord, safeJsonParse } from "../services/canonical-guard.service";
import {
  extractSystemInstructionFromMessages,
  stripSystemMessages,
} from "../services/canonical-message.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

/** Strands emits one event name for each message role. */
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
const extractStrandsContent = (eventAttrs: Record<string, unknown>): unknown => {
  const contentCandidates = [
    eventAttrs.content,
    eventAttrs["gen_ai.content"],
    eventAttrs.message,
    eventAttrs.text,
    eventAttrs["gen_ai.prompt.content"],
  ];

  for (const candidate of contentCandidates) {
    if (candidate === void 0 || candidate === null) continue;

    const parsed = safeJsonParse(candidate);

    if (typeof parsed === "string" && parsed.trim().length > 0) {
      return parsed;
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }

    if (isRecord(parsed)) {
      const obj = parsed;
      if (obj.text && typeof obj.text === "string") {
        return obj.text;
      }
      if (obj.content !== void 0) {
        return obj.content;
      }
    }
  }

  return void 0;
};

export class StrandsCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "strands";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const scopeName = ctx.span.instrumentationScope?.name;
    const isStrands =
      scopeName === "strands.telemetry.tracer" ||
      scopeName === "opentelemetry.instrumentation.strands" ||
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SYSTEM_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SERVICE_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.GEN_AI_AGENT_NAME) === "Strands Agents";

    if (!isStrands) {
      return;
    }

    const operationName = attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    if (operationName && typeof operationName === "string") {
      const proposedSpanType = OPERATION_NAMES_SPAN_TYPE_MAP[operationName];
      if (proposedSpanType) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
        ctx.recordRule(`${this.id}:gen_ai.operation_name->langwatch.span.type`);
      }
    }

    // Preserve event order because role-specific event names are interleaved.
    if (!ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const inputMessages: unknown[] = [];

      const roleEvents = ctx.bag.events.takeAllByNames(ROLE_EVENT_NAMES);
      for (const event of roleEvents) {
        const role = event.name.split(".")[1];
        const eventAttrs = event.attributes;

        const content = extractStrandsContent(eventAttrs);

        if (content !== void 0) {
          inputMessages.push({ role, content });
        }
      }

      if (inputMessages.length > 0) {
        const chatMessages = stripSystemMessages(inputMessages);
        const systemOnly = inputMessages.filter(
          (m) => isRecord(m) && m.role === "system",
        );
        if (systemOnly.length > 0) {
          const sysInstruction = extractSystemInstructionFromMessages(systemOnly);
          if (sysInstruction !== null) {
            ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
          }
        }

        if (chatMessages.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMessages);
          ctx.recordRule(`${this.id}:events->gen_ai.input.messages`);
          recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
        }
      }
    }

    const outputExtracted = extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (event: CanonicalEvent) => {
            const eventAttrs = event.attributes;

            const content = extractStrandsContent(eventAttrs);
            const role =
              typeof eventAttrs.role === "string" ? eventAttrs.role : "assistant";

            if (content !== void 0) {
              return {
                role,
                content,
                finish_reason: eventAttrs.finish_reason,
              };
            }
            return void 0;
          },
        },
      ],
      `${this.id}:gen_ai.choice->gen_ai.output.messages`,
    );

    if (outputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }

    const model =
      attrs.get(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ??
      attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
    if (typeof model === "string" && model.length > 0) {
      ctx.recordRule(`${this.id}:matched`);
    }
  }
}
