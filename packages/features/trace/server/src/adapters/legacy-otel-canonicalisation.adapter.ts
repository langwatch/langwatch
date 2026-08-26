/** Maps legacy OTel type, I/O, tool, and error attributes to canonical keys. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import {
  ALLOWED_SPAN_TYPES,
  extractErrorInfo,
  inferSpanTypeIfAbsent,
  recordValueType,
} from "../services/canonical-extraction.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

export class LegacyOtelCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "legacy-otel-traces";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      const directType =
        attrs.take(ATTR_KEYS.TYPE) ?? attrs.take(ATTR_KEYS.LANGWATCH_TYPE);
      if (typeof directType === "string" && ALLOWED_SPAN_TYPES.has(directType)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, directType);
        ctx.recordRule(`${this.id}:type(direct)`);
      }

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

    const inputValue = attrs.take(ATTR_KEYS.INPUT_VALUE) ?? attrs.take(ATTR_KEYS.INPUT);
    if (inputValue !== void 0 && ctx.out[ATTR_KEYS.LANGWATCH_INPUT] === void 0) {
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
    if (outputValue !== void 0 && ctx.out[ATTR_KEYS.LANGWATCH_OUTPUT] === void 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_OUTPUT, outputValue);
      ctx.recordRule(`${this.id}:output->langwatch.output`);
      recordValueType(
        ctx,
        ATTR_KEYS.LANGWATCH_OUTPUT,
        typeof outputValue === "string" ? "text" : "json",
      );
    }

    const toolArgs = attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS);
    if (toolArgs !== void 0 && ctx.out[ATTR_KEYS.LANGWATCH_INPUT] === void 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, toolArgs);
      ctx.recordRule(`${this.id}:ai.toolCall.args->langwatch.input`);
      recordValueType(
        ctx,
        ATTR_KEYS.LANGWATCH_INPUT,
        typeof toolArgs === "string" ? "text" : "json",
      );
    }

    if (!attrs.has(ATTR_KEYS.ERROR_TYPE)) {
      extractErrorInfo(ctx);
    }
  }
}
