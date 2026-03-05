/**
 * Legacy OTel Attributes Extractor
 *
 * Handles: Legacy OpenTelemetry patterns and non-standard LLM attributes
 * that don't fit the modern gen_ai.* semantic conventions.
 *
 * This extractor handles:
 * - Legacy span type detection (type, langwatch.type, span.kind patterns)
 * - Legacy input/output attributes (input.value, output.value)
 * - Tool call argument extraction
 * - Error type inference from various sources
 *
 * Detection: Presence of llm.request.type, type, input.value, output.value,
 * or tool call indicators
 *
 * Note: Legacy gen_ai.* attributes (like gen_ai.prompt, gen_ai.completion)
 * are handled by genAi.ts to keep namespace handling consolidated.
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from various legacy type indicators)
 * - langwatch.input (from input.value, input, ai.toolCall.args)
 * - langwatch.output (from output.value, output)
 * - error.type (from exception.*, status.message, span.error.*)
 */

import { ATTR_KEYS } from "./_constants";
import { ALLOWED_SPAN_TYPES, extractErrorInfo, inferSpanTypeIfAbsent, recordValueType } from "./_extraction";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class LegacyOtelTracesExtractor implements CanonicalAttributesExtractor {
  readonly id = "legacy-otel-traces";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type Detection
    // Multiple legacy patterns for determining span type
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      // Direct type attribute (legacy)
      const directType =
        attrs.take(ATTR_KEYS.TYPE) ?? attrs.take(ATTR_KEYS.LANGWATCH_TYPE);
      if (
        typeof directType === "string" &&
        ALLOWED_SPAN_TYPES.has(directType)
      ) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, directType);
        ctx.recordRule(`${this.id}:type(direct)`);
      }

      // Span kind strings (best-effort mapping)
      const spanKind =
        attrs.get(ATTR_KEYS.SPAN_KIND) ??
        attrs.get(ATTR_KEYS.OTEL_SPAN_KIND) ??
        attrs.get(ATTR_KEYS.INCOMING_SPAN_KIND);
      if (typeof spanKind === "string") {
        if (spanKind.includes("SERVER")) {
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "server");
        }
        if (spanKind.includes("CLIENT")) {
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "client");
        }
        if (spanKind.includes("PRODUCER")) {
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "producer");
        }
        if (spanKind.includes("CONSUMER")) {
          ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "consumer");
        }
      }

      // llm.request.type chat|completion → infer as LLM span
      const requestType = attrs.take(ATTR_KEYS.LLM_REQUEST_TYPE);
      if (requestType === "chat" || requestType === "completion") {
        inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:llm.request.type->llm`);
      }

      // Tool call detection from operation name or explicit attribute
      const operationName = attrs.get(ATTR_KEYS.OPERATION_NAME);
      if (
        operationName === "ai.toolCall" ||
        attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME)
      ) {
        ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "tool");
        ctx.recordRule(`${this.id}:toolcall->tool`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Input/Output Extraction
    // Maps input.value/input → langwatch.input
    // Maps output.value/output → langwatch.output
    // ─────────────────────────────────────────────────────────────────────────
    const inputValue =
      attrs.take(ATTR_KEYS.INPUT_VALUE) ?? attrs.take(ATTR_KEYS.INPUT);
    if (inputValue !== undefined && ctx.out[ATTR_KEYS.LANGWATCH_INPUT] === undefined) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, inputValue);
      ctx.recordRule(`${this.id}:input->langwatch.input`);
      recordValueType(
        ctx,
        ATTR_KEYS.LANGWATCH_INPUT,
        typeof inputValue === "string" ? "text" : "json",
      );
    }

    const outputValue =
      attrs.take(ATTR_KEYS.OUTPUT_VALUE) ?? attrs.take(ATTR_KEYS.OUTPUT);
    if (outputValue !== undefined && ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT] === undefined) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_OUTPUT, outputValue);
      ctx.recordRule(`${this.id}:output->langwatch.output`);
      recordValueType(
        ctx,
        ATTR_KEYS.LANGWATCH_OUTPUT,
        typeof outputValue === "string" ? "text" : "json",
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tool Call Arguments
    // Surface ai.toolCall.args as langwatch.input for tool spans
    // ─────────────────────────────────────────────────────────────────────────
    const toolArgs = attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS);
    if (toolArgs !== undefined && ctx.out[ATTR_KEYS.LANGWATCH_INPUT] === undefined) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, toolArgs);
      ctx.recordRule(`${this.id}:ai.toolCall.args->langwatch.input`);
      recordValueType(
        ctx,
        ATTR_KEYS.LANGWATCH_INPUT,
        typeof toolArgs === "string" ? "text" : "json",
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Error Type Inference
    // Delegates to shared extractErrorInfo for consistent behavior across
    // all extractors. Priority: span.error > exception > status.message
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.ERROR_TYPE)) {
      extractErrorInfo(ctx);
    }
  }
}
