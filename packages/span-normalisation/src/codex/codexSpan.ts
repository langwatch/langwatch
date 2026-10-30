import { ATTR_KEYS, CODEX_TURN_SPAN_NAME } from "../attributeKeys.ts";
import { type ExtractorContext, takeAttribute } from "../canonicalAttributes.ts";
import { restateInputAsFresh, setFreshInputTokens } from "../canonicalExtraction.ts";
import {
  applyCanonicalLifts,
  asNumber,
  asString,
  CODEX_PROVIDER_KEY,
  CODEX_REDUNDANT_USAGE_SPAN_NAMES,
  extractConversationId,
  isCodexModel,
  computeNonCachedInput,
  toPositiveOrNull,
  type CanonicalLift,
} from "./codexCanonicalValue.ts";

/**
 * Codex's scope names, injected from the coding-agent contract (packages take module
 * values by injection).
 */
export interface CodexScopes {
  isCodexScope: (scopeName: string) => boolean;
  execScope: string;
}

export class CodexSpanCanonicaliserService {
  private readonly scopes: CodexScopes;

  private constructor(scopes: CodexScopes) {
    this.scopes = scopes;
  }

  static create({ scopes }: { scopes: CodexScopes }): CodexSpanCanonicaliserService {
    return new CodexSpanCanonicaliserService(scopes);
  }

  apply(ctx: ExtractorContext): void {
    this.markCodexProviderBundled(ctx);

    const scopeName = ctx.span.instrumentationScope?.name ?? "";
    if (!this.scopes.isCodexScope(scopeName)) {
      return;
    }

    if (ctx.span.name !== CODEX_TURN_SPAN_NAME) {
      this.liftResponseSpan(ctx);
      this.restateWholeInput(ctx);
      this.typeUsageSpanAsModelCall(ctx);
      if (scopeName !== this.scopes.execScope) {
        this.markRedundantUsageSpan(ctx);
      }

      return;
    }

    ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "agent");

    const { attrs } = ctx.bag;
    const model = asString(takeAttribute(attrs, "model"));
    const cacheRead = asNumber(takeAttribute(attrs, "codex.turn.token_usage.cached_input_tokens"));
    const cacheCreation = asNumber(
      takeAttribute(attrs, "codex.turn.token_usage.cache_write_input_tokens"),
    );
    const lifts: CanonicalLift[] = [
      [ATTR_KEYS.GEN_AI_REQUEST_MODEL, model],
      [ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model],
      [
        ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
        asNumber(takeAttribute(attrs, "codex.turn.token_usage.output_tokens")),
      ],
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cacheRead],
      [ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, cacheCreation],
      [
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        asNumber(takeAttribute(attrs, "codex.turn.token_usage.reasoning_output_tokens")),
      ],
      [
        ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
        asString(takeAttribute(attrs, "codex.turn.reasoning_effort")),
      ],
      [ATTR_KEYS.GEN_AI_CONVERSATION_ID, extractConversationId(attrs)],
    ];

    const nonCachedInput = computeNonCachedInput({ attrs, cacheRead, cacheCreation });
    if (applyCanonicalLifts(ctx, lifts) || nonCachedInput !== null) {
      ctx.recordRule("codex/session_task.turn");
    }
    // Codex's own non-cached count wins over a whole input the GenAI pass read.
    if (nonCachedInput !== null) {
      setFreshInputTokens(ctx, {
        freshInput: nonCachedInput,
        ruleId: "codex/session_task.turn(fresh input)",
      });
    } else {
      this.restateWholeInput(ctx);
    }

    if (scopeName === this.scopes.execScope && this.hasTokenUsage(ctx)) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
      ctx.recordRule("codex/skip-exec-rollup-usage");
    }
  }

  private liftResponseSpan(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const lifts: CanonicalLift[] = [
      [
        ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
        asString(takeAttribute(attrs, "codex.request.reasoning_effort")),
      ],
      [
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        toPositiveOrNull(asNumber(takeAttribute(attrs, "codex.usage.reasoning_output_tokens"))),
      ],
      [
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        toPositiveOrNull(asNumber(attrs.get("gen_ai.usage.cache_write.input_tokens"))),
      ],
    ];

    if (applyCanonicalLifts(ctx, lifts)) {
      ctx.recordRule("codex/handle_responses");
    }
  }

  /**
   * Codex sends `gen_ai.usage.input_tokens` as the whole input, cached tokens included, as the
   * OpenAI usage does.
   */
  private restateWholeInput(ctx: ExtractorContext): void {
    restateInputAsFresh(ctx, { cacheWrite: 0, ruleId: "codex/usage.input_tokens(fresh)" });
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

    if (CODEX_REDUNDANT_USAGE_SPAN_NAMES[ctx.span.name] !== true) {
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
