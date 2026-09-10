import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../services/canonicalisers/canonical-attributes.service.ts";
import { isRecord } from "./canonical-guard.rules.ts";
import { isLangWatchStructuredValue } from "./langwatch-structured-value.rules.ts";

const LANGWATCH_RULE_PREFIX = "langwatch";

export function canonicaliseLangWatchMetrics(ctx: ExtractorContext): void {
  canonicaliseMetrics(ctx);
  canonicaliseEvaluation(ctx);
}

/** The metrics record a span carries, whether wrapped in a structured value or sent bare. */
function readMetricsValue(rawMetrics: unknown): Record<string, unknown> | null {
  const structured = isLangWatchStructuredValue(rawMetrics) ? rawMetrics : null;
  if (structured && isRecord(structured.value)) return structured.value;
  if (isRecord(rawMetrics)) return rawMetrics;

  return null;
}

/** The first key that carries a finite number, under either spelling. */
function numberField(metrics: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

const isPositive = (value: number): boolean => value > 0;
const isNonNegative = (value: number): boolean => value >= 0;

/** One metric key, its canonical attribute, the spellings it arrives under, and what it accepts. */
const METRIC_FIELDS = [
  {
    attribute: ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
    keys: ["promptTokens", "prompt_tokens"],
    rule: "metrics.promptTokens",
    accepts: isPositive,
  },
  {
    attribute: ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
    keys: ["completionTokens", "completion_tokens"],
    rule: "metrics.completionTokens",
    accepts: isPositive,
  },
  {
    attribute: ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
    keys: ["reasoningTokens", "reasoning_tokens"],
    rule: "metrics.reasoningTokens",
    accepts: isPositive,
  },
  {
    attribute: ATTR_KEYS.LANGWATCH_SPAN_COST,
    keys: ["cost"],
    rule: "metrics.cost",
    accepts: isPositive,
  },
  {
    attribute: ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN,
    keys: ["firstTokenMs", "first_token_ms"],
    rule: "metrics.firstTokenMs",
    accepts: isNonNegative,
  },
] as const;

function canonicaliseMetrics(ctx: ExtractorContext): void {
  const rawMetrics = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_METRICS);
  if (rawMetrics === void 0) return;

  const metricsValue = readMetricsValue(rawMetrics);
  if (!metricsValue) return;

  for (const field of METRIC_FIELDS) {
    const value = numberField(metricsValue, ...field.keys);
    if (value === null || !field.accepts(value)) continue;

    ctx.setAttrIfAbsent(field.attribute, value);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:${field.rule}`);
  }

  const tokensEstimated = metricsValue.tokensEstimated ?? metricsValue.tokens_estimated;
  if (tokensEstimated === true) {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, true);
    ctx.recordRule(`${LANGWATCH_RULE_PREFIX}:metrics.tokensEstimated`);
  }
}

/** The three semconv evaluation attributes one custom-evaluation payload carries. */
function applyEvaluationPayload(ctx: ExtractorContext, parsed: Record<string, unknown>): void {
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
}

function canonicaliseEvaluation(ctx: ExtractorContext): void {
  for (const event of ctx.bag.events.all()) {
    if (event.name !== "langwatch.evaluation.custom") continue;

    const jsonPayload = event.attributes.json_encoded_event;
    if (jsonPayload === void 0 || jsonPayload === null) continue;

    try {
      const parsed = typeof jsonPayload === "string" ? JSON.parse(jsonPayload) : jsonPayload;
      if (!isRecord(parsed)) continue;

      applyEvaluationPayload(ctx, parsed);
      break; // Only first evaluation maps to semconv
    } catch {
      // A payload that does not parse carries no evaluation to map.
    }
  }
}
