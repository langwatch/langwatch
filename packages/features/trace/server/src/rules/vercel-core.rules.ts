import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import {
  extractModelToBoth,
  extractUsageTokens,
  normaliseModelFromAiModelObject,
} from "./canonical-extraction.rules";
import { asNumber } from "./canonical-guard.rules";
import { AI_SDK_SPAN_TYPE_MAP, canonicaliseVercelToolCall } from "./vercel-tool-call.rules";

const VERCEL_RULE_PREFIX = "vercel";

export function canonicaliseVercelCore(ctx: ExtractorContext): boolean {
  if (!isVercelSpan(ctx)) {
    return false;
  }

  canonicaliseSpanIdentity(ctx);
  canonicaliseUsage(ctx);
  return true;
}

function isVercelSpan(ctx: ExtractorContext): boolean {
  const { attrs } = ctx.bag;

  const scopeMatches = ctx.span.instrumentationScope.name === "ai";
  const attrsMatch =
    attrs.has(ATTR_KEYS.AI_MODEL) ||
    attrs.has(ATTR_KEYS.AI_PROMPT_MESSAGES) ||
    attrs.has(ATTR_KEYS.AI_PROMPT) ||
    attrs.has(ATTR_KEYS.AI_RESPONSE) ||
    attrs.has(ATTR_KEYS.AI_RESPONSE_TEXT) ||
    attrs.has(ATTR_KEYS.AI_RESPONSE_OBJECT) ||
    attrs.has(ATTR_KEYS.AI_USAGE) ||
    attrs.has(ATTR_KEYS.AI_USAGE_INPUT_TOKENS) ||
    attrs.has(ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS) ||
    attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME);
  return scopeMatches || attrsMatch;
}

function canonicaliseSpanIdentity(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  const proposedSpanType = AI_SDK_SPAN_TYPE_MAP[ctx.span.name];
  if (proposedSpanType) {
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
    ctx.recordRule(`${VERCEL_RULE_PREFIX}:span.name->langwatch.span.type`);
  }

  if (ctx.span.name === ATTR_KEYS.AI_TOOL_CALL) {
    canonicaliseVercelToolCall(ctx);
  }

  if (
    !extractModelToBoth({
      ctx,
      sourceKey: ATTR_KEYS.AI_MODEL,
      ruleId: `${VERCEL_RULE_PREFIX}:ai.model->gen_ai.*.model`,
      transform: (raw) => normaliseModelFromAiModelObject(raw),
    })
  ) {
    attrs.take(ATTR_KEYS.AI_MODEL);
  }
}

function canonicaliseUsage(ctx: ExtractorContext): void {
  const { attrs } = ctx.bag;
  extractUsageTokens(
    ctx,
    { object: ATTR_KEYS.AI_USAGE },
    `${VERCEL_RULE_PREFIX}:ai.usage->gen_ai.usage`,
  );

  const canonicalInput =
    asNumber(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]) ??
    asNumber(attrs.get(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS));
  if (canonicalInput !== null) {
    const cacheRead =
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS)) ??
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS));
    const cacheWrite = asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS));
    const noCacheTokens = asNumber(attrs.take(ATTR_KEYS.AI_USAGE_NO_CACHE_TOKENS));
    if (cacheRead !== null && cacheRead > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheRead);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.usage.cacheRead->gen_ai.usage.cache_read`);
    }
    if (cacheWrite !== null && cacheWrite > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheWrite);
      ctx.recordRule(`${VERCEL_RULE_PREFIX}:ai.usage.cacheWrite->gen_ai.usage.cache_creation`);
    }

    if ((cacheRead ?? 0) > 0 || (cacheWrite ?? 0) > 0) {
      const freshInput =
        noCacheTokens ?? Math.max(0, canonicalInput - (cacheRead ?? 0) - (cacheWrite ?? 0));
      if (freshInput !== canonicalInput) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, freshInput);
        ctx.recordRule(
          `${VERCEL_RULE_PREFIX}:ai.usage.inputTokens->gen_ai.usage.input_tokens(fresh)`,
        );
      }
    }

    const reasoningTokens = asNumber(attrs.take(ATTR_KEYS.AI_USAGE_REASONING_TOKENS));
    if (reasoningTokens !== null && reasoningTokens > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
      ctx.recordRule(
        `${VERCEL_RULE_PREFIX}:ai.usage.reasoningTokens->gen_ai.usage.reasoning_tokens`,
      );
    }
  }
}
