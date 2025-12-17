import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import {
  safeJsonParse,
  isNonEmptyString,
  ALLOWED_SPAN_TYPES,
  inferSpanTypeIfAbsent,
} from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from legacy OpenTelemetry trace formats.
 * 
 * Handles:
 * - Type inference from various legacy formats (`type`, `langwatch.type`, `span.kind`, etc.)
 * - `llm.request.type` → `langwatch.span.type` = "llm"
 * - `ai.toolCall.args` → `langwatch.input`
 * - `output.value` / `output` → `langwatch.output`
 * - Error type inference from exception/status messages
 * 
 * This extractor handles older OpenTelemetry formats and legacy LangWatch attributes.
 * 
 * @example
 * ```typescript
 * const extractor = new LegacyOtelTracesExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class LegacyOtelTracesExtractor implements CanonicalAttributesExtractor {
  readonly id = "legacy-otel-traces";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ---------------------------------------------------------------------
    // Type inference / mapping
    // ---------------------------------------------------------------------

    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      // legacy direct
      const direct = attrs.take(ATTR_KEYS.TYPE) ?? attrs.take(ATTR_KEYS.LANGWATCH_TYPE);
      if (typeof direct === "string" && ALLOWED_SPAN_TYPES.has(direct)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, direct);
        ctx.recordRule(`${this.id}:type(direct)`);
      }

      // span kind strings (best-effort)
      const spanKind =
        attrs.get(ATTR_KEYS.SPAN_KIND) ??
        attrs.get(ATTR_KEYS.OTEL_SPAN_KIND) ??
        attrs.get(ATTR_KEYS.INCOMING_SPAN_KIND);
      if (typeof spanKind === "string") {
        if (spanKind.includes("SERVER"))
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "server");
        if (spanKind.includes("CLIENT"))
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "client");
        if (spanKind.includes("PRODUCER"))
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "producer");
        if (spanKind.includes("CONSUMER"))
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "consumer");
      }

      // llm.request.type chat|completion => llm
      const reqType = attrs.take(ATTR_KEYS.LLM_REQUEST_TYPE);
      if (reqType === "chat" || reqType === "completion") {
        inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm.request.type->llm`);
      }

      // toolcall op name
      const opName = attrs.get(ATTR_KEYS.OPERATION_NAME);
      if (opName === "ai.toolCall" || attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME)) {
        ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "tool");
        ctx.recordRule(`${this.id}:toolcall->tool`);
      }
    }

    // toolcall args: useful to surface into langwatch.input (and/or gen_ai.input.messages)
    const toolArgs = attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS);
    if (toolArgs !== undefined) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, safeJsonParse(toolArgs));
      ctx.recordRule(`${this.id}:ai.toolCall.args->langwatch.input`);
    }

    // output.value/output legacy => langwatch.output
    const outVal = attrs.take(ATTR_KEYS.OUTPUT_VALUE) ?? attrs.take(ATTR_KEYS.OUTPUT);
    if (outVal !== undefined) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_OUTPUT, safeJsonParse(outVal));
      ctx.recordRule(`${this.id}:output->langwatch.output`);
    }

    // ---------------------------------------------------------------------
    // error.type best-effort (don't override)
    // ---------------------------------------------------------------------

    if (!attrs.has(ATTR_KEYS.ERROR_TYPE)) {
      const exceptionType = attrs.get(ATTR_KEYS.EXCEPTION_TYPE);
      const exceptionMsg = attrs.get(ATTR_KEYS.EXCEPTION_MESSAGE);
      const statusMsg = attrs.get(ATTR_KEYS.STATUS_MESSAGE);

      const spanErrHas =
        attrs.get(ATTR_KEYS.SPAN_ERROR_HAS_ERROR) ?? attrs.get(ATTR_KEYS.ERROR_HAS_ERROR);
      const spanErrMsg =
        attrs.get(ATTR_KEYS.SPAN_ERROR_MESSAGE) ?? attrs.get(ATTR_KEYS.ERROR_MESSAGE);

      if (
        typeof spanErrHas === "boolean" &&
        spanErrHas &&
        isNonEmptyString(spanErrMsg)
      ) {
        ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, spanErrMsg);
        ctx.recordRule(`${this.id}:error(span.error)`);
      } else if (
        isNonEmptyString(exceptionType) &&
        isNonEmptyString(exceptionMsg)
      ) {
        ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, `${exceptionType}: ${exceptionMsg}`);
        ctx.recordRule(`${this.id}:error(exception)`);
      } else if (isNonEmptyString(statusMsg)) {
        ctx.setAttrIfAbsent(ATTR_KEYS.ERROR_TYPE, statusMsg);
        ctx.recordRule(`${this.id}:error(status.message)`);
      }
    }
  }
}
