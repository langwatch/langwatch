/** Maps Strands' event-based messages and operation names to canonical keys. */

import type { CanonicalEvent } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import { extractOutputMessages, recordValueType } from "../../../rules/canonical-extraction.rules.ts";
import { isRecord, safeJsonParse } from "../../../rules/canonical-guard.rules.ts";
import {
  extractSystemInstructionFromMessages,
  stripSystemMessages,
} from "../../../rules/canonical-message.rules.ts";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../canonical-attributes.service.ts";

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
 * Extracts content from Strands event attributes, which can be a direct string, an array of
 * content parts, or nested under the `gen_ai.content` attribute.
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
    if (candidate === void 0 || candidate === null) {
      continue;
    }

    const content = strandsContentOfCandidate(candidate);
    if (content !== void 0) {
      return content;
    }
  }

  return void 0;
};

/** One candidate attribute as content: a non-empty string, a non-empty array, or a wrapper's field. */
const strandsContentOfCandidate = (candidate: unknown): unknown => {
  const parsed = safeJsonParse(candidate);

  if (typeof parsed === "string" && parsed.trim().length > 0) {
    return parsed;
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed;
  }

  if (isRecord(parsed)) {
    if (parsed.text && typeof parsed.text === "string") {
      return parsed.text;
    }

    return parsed.content;
  }

  return void 0;
};

export class StrandsCanonicaliserService implements CanonicalAttributesPort {
  static create(): StrandsCanonicaliserService {
    return new StrandsCanonicaliserService();
  }

  readonly id = "strands";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    if (!this.isStrands(ctx)) {
      return;
    }

    this.canonicaliseSpanType(ctx);
    if (!attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      this.canonicaliseInputMessages(ctx);
    }

    const outputExtracted = extractOutputMessages(
      ctx,
      [{ type: "event", name: "gen_ai.choice", extractor: strandsChoiceMessage }],
      `${this.id}:gen_ai.choice->gen_ai.output.messages`,
    );
    if (outputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }

    const model =
      attrs.get(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ?? attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
    if (typeof model === "string" && model.length > 0) {
      ctx.recordRule(`${this.id}:matched`);
    }
  }

  /** Whether the span came from Strands, by scope name or by any of the names it stamps. */
  private isStrands(ctx: ExtractorContext): boolean {
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

  private canonicaliseSpanType(ctx: ExtractorContext): void {
    const operationName = ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    if (typeof operationName !== "string") {
      return;
    }

    const proposedSpanType = OPERATION_NAMES_SPAN_TYPE_MAP[operationName];
    if (proposedSpanType) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
      ctx.recordRule(`${this.id}:gen_ai.operation_name->langwatch.span.type`);
    }
  }

  /**
   * The conversation Strands reports as role-named events. Event order is preserved because the
   * role-specific names are interleaved, and the system turn is lifted to its own attribute.
   */
  private canonicaliseInputMessages(ctx: ExtractorContext): void {
    const inputMessages: unknown[] = [];
    for (const event of ctx.bag.events.takeAllByNames(ROLE_EVENT_NAMES)) {
      const role = event.name.split(".")[1];
      const content = extractStrandsContent(event.attributes);
      if (content !== void 0) {
        inputMessages.push({ role, content });
      }
    }

    if (inputMessages.length === 0) {
      return;
    }

    const systemOnly = inputMessages.filter(
      (message) => isRecord(message) && message.role === "system",
    );
    if (systemOnly.length > 0) {
      const sysInstruction = extractSystemInstructionFromMessages(systemOnly);
      if (sysInstruction !== null) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
      }
    }

    const chatMessages = stripSystemMessages(inputMessages);
    if (chatMessages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMessages);
      ctx.recordRule(`${this.id}:events->gen_ai.input.messages`);
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }
  }
}

/** One Strands choice event as an output message, or nothing when it carried no content. */
function strandsChoiceMessage(event: CanonicalEvent): unknown {
  const eventAttrs = event.attributes;
  const content = extractStrandsContent(eventAttrs);
  if (content === void 0) {
    return void 0;
  }

  const role = typeof eventAttrs.role === "string" ? eventAttrs.role : "assistant";

  return { role, content, finish_reason: eventAttrs.finish_reason };
}
