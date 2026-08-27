import { ATTR_KEYS, CODEX_TURN_SPAN_NAME } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../ports/canonical-attributes.port";
import {
  applyCanonicalLifts,
  asNumber,
  asString,
  CODEX_EXEC_SCOPE_NAME,
  CODEX_PROVIDER_KEY,
  CODEX_REDUNDANT_USAGE_SPAN_NAMES,
  CODEX_SCOPE_NAMES,
  conversationIdOf,
  isCodexModel,
  nonCachedInput,
  positiveOrNull,
  type CanonicalLift,
} from "./codex-canonical-value.rules";

export class CodexSpanCanonicaliser {
  apply(ctx: ExtractorContext): void {
    this.markCodexProviderBundled(ctx);

    const scopeName = ctx.span.instrumentationScope?.name ?? "";
    if (!CODEX_SCOPE_NAMES.has(scopeName)) {
      return;
    }

    if (ctx.span.name !== CODEX_TURN_SPAN_NAME) {
      this.liftResponseSpan(ctx);
      this.typeUsageSpanAsModelCall(ctx);
      if (scopeName !== CODEX_EXEC_SCOPE_NAME) {
        this.markRedundantUsageSpan(ctx);
      }
      return;
    }

    ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "agent");

    const { attrs } = ctx.bag;
    const model = asString(attrs.take("model"));
    const cacheRead = asNumber(attrs.take("codex.turn.token_usage.cached_input_tokens"));
    const cacheCreation = asNumber(attrs.take("codex.turn.token_usage.cache_write_input_tokens"));
    const lifts: CanonicalLift[] = [
      [ATTR_KEYS.GEN_AI_REQUEST_MODEL, model],
      [ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model],
      [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, nonCachedInput({ attrs, cacheRead, cacheCreation })],
      [
        ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
        asNumber(attrs.take("codex.turn.token_usage.output_tokens")),
      ],
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheRead],
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreation],
      [
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        asNumber(attrs.take("codex.turn.token_usage.reasoning_output_tokens")),
      ],
      [
        ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
        asString(attrs.take("codex.turn.reasoning_effort")),
      ],
      [ATTR_KEYS.GEN_AI_CONVERSATION_ID, conversationIdOf(attrs)],
    ];

    if (applyCanonicalLifts(ctx, lifts)) {
      ctx.recordRule("codex/session_task.turn");
    }

    if (scopeName === CODEX_EXEC_SCOPE_NAME && this.hasTokenUsage(ctx)) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
      ctx.recordRule("codex/skip-exec-rollup-usage");
    }
  }

  private liftResponseSpan(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const lifts: CanonicalLift[] = [
      [
        ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
        asString(attrs.take("codex.request.reasoning_effort")),
      ],
      [
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        positiveOrNull(asNumber(attrs.take("codex.usage.reasoning_output_tokens"))),
      ],
      [
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        positiveOrNull(asNumber(attrs.get("gen_ai.usage.cache_write.input_tokens"))),
      ],
    ];

    if (applyCanonicalLifts(ctx, lifts)) {
      ctx.recordRule("codex/handle_responses");
    }
  }

  private typeUsageSpanAsModelCall(ctx: ExtractorContext): void {
    if (!this.hasTokenUsage(ctx)) {
      return;
    }
    ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "llm");
  }

  private markRedundantUsageSpan(ctx: ExtractorContext): void {
    if (!this.hasTokenUsage(ctx)) {
      return;
    }
    if (!CODEX_REDUNDANT_USAGE_SPAN_NAMES.has(ctx.span.name)) {
      return;
    }
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
    ctx.recordRule("codex/skip-redundant-usage");
  }

  private hasTokenUsage(ctx: ExtractorContext): boolean {
    return (
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] !== void 0 ||
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS] !== void 0 ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS) ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS)
    );
  }

  private markCodexProviderBundled(ctx: ExtractorContext): void {
    const read = (key: string): unknown => ctx.out[key] ?? ctx.bag.attrs.get(key);

    if (read(ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE) !== void 0) {
      return;
    }

    const isCodex =
      read(ATTR_KEYS.GEN_AI_PROVIDER_NAME) === CODEX_PROVIDER_KEY ||
      [read(ATTR_KEYS.GEN_AI_REQUEST_MODEL), read(ATTR_KEYS.GEN_AI_RESPONSE_MODEL)].some(
        (model) => typeof model === "string" && isCodexModel(model),
      );
    if (!isCodex) {
      return;
    }

    ctx.setAttr(ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE, "true");
    ctx.recordRule("codex/bundled-cost");
  }
}
