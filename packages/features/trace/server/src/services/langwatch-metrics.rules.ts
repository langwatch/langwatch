import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import { isRecord } from "./canonical-guard.rules";
import { isLangWatchStructuredValue } from "./langwatch-structured-value.rules";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchMetrics(ctx: ExtractorContext): void {
  canonicaliseMetrics(ctx);
  canonicaliseEvaluation(ctx);
}

function canonicaliseMetrics(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const rawMetrics = attrs.take(ATTR_KEYS.LANGWATCH_METRICS);
  if (rawMetrics !== void 0) {
    let metricsValue: Record<string, unknown> | null = null;
    if (isLangWatchStructuredValue(rawMetrics) && isRecord(rawMetrics.value)) {
      metricsValue = rawMetrics.value;
    } else if (isRecord(rawMetrics)) {
      metricsValue = rawMetrics;
    }

    if (metricsValue) {
      const numberField = (...keys: string[]): number | null => {
        for (const key of keys) {
          const value = metricsValue[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            return value;
          }
        }
        return null;
      };

      const promptTokens = numberField("promptTokens", "prompt_tokens");
      if (promptTokens !== null && promptTokens > 0) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.promptTokens`);
      }

      const completionTokens = numberField("completionTokens", "completion_tokens");
      if (completionTokens !== null && completionTokens > 0) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.completionTokens`);
      }

      const reasoningTokens = numberField("reasoningTokens", "reasoning_tokens");
      if (reasoningTokens !== null && reasoningTokens > 0) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.reasoningTokens`);
      }

      const cost = numberField("cost");
      if (cost !== null && cost > 0) {
        ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_SPAN_COST, cost);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.cost`);
      }

      const firstTokenMs = numberField("firstTokenMs", "first_token_ms");
      if (firstTokenMs !== null && firstTokenMs >= 0) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN, firstTokenMs);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.firstTokenMs`);
      }

      const tokensEstimated = metricsValue.tokensEstimated ?? metricsValue.tokens_estimated;
      if (tokensEstimated === true) {
        ctx.setAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, true);
        ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.tokensEstimated`);
      }
    }
  }
}

function canonicaliseEvaluation(ctx: ExtractorContext): void {
  for (const event of ctx.bag.events.all()) {
    if (event.name !== "langwatch.evaluation.custom") {
      continue;
    }

    const eventAttrs = event.attributes;
    const jsonPayload = eventAttrs.json_encoded_event;
    if (jsonPayload === void 0 || jsonPayload === null) {
      continue;
    }

    try {
      const parsed = typeof jsonPayload === "string" ? JSON.parse(jsonPayload) : jsonPayload;
      if (!isRecord(parsed)) {
        continue;
      }

      if (typeof parsed.name === "string") {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_EVALUATION_NAME, parsed.name);
      }
      if (typeof parsed.label === "string") {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL, parsed.label);
      }
      if (typeof parsed.score === "number") {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE, parsed.score);
      }
      ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:evaluation.custom`);
      break; // Only first evaluation maps to semconv
    } catch {}
  }
}
