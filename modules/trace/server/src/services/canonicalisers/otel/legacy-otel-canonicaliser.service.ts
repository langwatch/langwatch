/** Maps legacy OTel type, I/O, tool, and error attributes to canonical keys. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import {
  ALLOWED_SPAN_TYPES,
  extractErrorInfo,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "../../../rules/canonical-extraction.rules.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "../canonical-attributes.service.ts";

/** OTel span kinds that name a span type on their own, in the spelling they arrive with. */
const SPAN_KIND_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["SERVER", "server"],
  ["CLIENT", "client"],
  ["PRODUCER", "producer"],
  ["CONSUMER", "consumer"],
];

export class LegacyOtelCanonicaliserService implements AttributeCanonicaliser {
  static create(): LegacyOtelCanonicaliserService {
    return new LegacyOtelCanonicaliserService();
  }

  readonly id = "legacy-otel-traces";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      this.canonicaliseSpanType(ctx);
    }

    this.liftValue({
      ctx,
      value: attrs.take(ATTR_KEYS.INPUT_VALUE) ?? attrs.take(ATTR_KEYS.INPUT),
      target: ATTR_KEYS.LANGWATCH_INPUT,
      rule: `${this.id}:input->langwatch.input`,
    });
    this.liftValue({
      ctx,
      value: attrs.take(ATTR_KEYS.OUTPUT_VALUE) ?? attrs.take(ATTR_KEYS.OUTPUT),
      target: ATTR_KEYS.LANGWATCH_OUTPUT,
      rule: `${this.id}:output->langwatch.output`,
    });
    this.liftValue({
      ctx,
      value: attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS),
      target: ATTR_KEYS.LANGWATCH_INPUT,
      rule: `${this.id}:ai.toolCall.args->langwatch.input`,
    });

    if (!attrs.has(ATTR_KEYS.ERROR_TYPE)) {
      extractErrorInfo(ctx);
    }
  }

  /**
   * The span type an emitter stated directly, or the one its kind, request type or operation name
   * implies. Each source is weaker than the one before, so the first to answer wins.
   */
  private canonicaliseSpanType(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const directType = attrs.take(ATTR_KEYS.TYPE) ?? attrs.take(ATTR_KEYS.LANGWATCH_TYPE);
    if (typeof directType === "string" && ALLOWED_SPAN_TYPES[directType] === true) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, directType);
      ctx.recordRule(`${this.id}:type(direct)`);
    }

    const spanKind =
      attrs.get(ATTR_KEYS.SPAN_KIND) ??
      attrs.get(ATTR_KEYS.OTEL_SPAN_KIND) ??
      attrs.get(ATTR_KEYS.INCOMING_SPAN_KIND);
    if (typeof spanKind === "string") {
      for (const [kind, spanType] of SPAN_KIND_TYPES) {
        if (spanKind.includes(kind)) {
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, spanType);
        }
      }
    }

    const requestType = attrs.take(ATTR_KEYS.LLM_REQUEST_TYPE);
    if (requestType === "chat" || requestType === "completion") {
      inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm.request.type->llm`);
    }

    const operationName = attrs.get(ATTR_KEYS.OPERATION_NAME);
    if (operationName === "ai.toolCall" || attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME)) {
      ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "tool");
      ctx.recordRule(`${this.id}:toolcall->tool`);
    }
  }

  /** One legacy carrier lifted onto its canonical key, with the value type it turned out to be. */
  private liftValue({
    ctx,
    value,
    target,
    rule,
  }: {
    ctx: ExtractorContext;
    value: unknown;
    target: string;
    rule: string;
  }): void {
    if (value === void 0 || ctx.out[target] !== void 0) {
      return;
    }

    ctx.setAttrIfAbsent(target, value);
    ctx.recordRule(rule);
    recordValueType(ctx, target, typeof value === "string" ? "text" : "json");
  }
}
