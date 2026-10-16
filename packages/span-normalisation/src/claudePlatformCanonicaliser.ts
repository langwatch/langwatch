/**
 * Counts each token of a Claude Platform (Claude API OpenTelemetry export) trace once.
 * Rule: https://platform.claude.com/docs/en/manage-claude/opentelemetry#count-tokens
 */

import { ATTR_KEYS } from "./attributeKeys.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";

/** The instrumentation scope of every span the Claude API exports. */
const CLAUDE_PLATFORM_SCOPE = "com.anthropic.claude-platform";

/** The API spans whose usage is their own step's; every other API span repeats its children's. */
const COUNTED_SPAN_NAMES = new Set([
  "anthropic.model_request",
  "anthropic.compaction",
  "anthropic.session.outcome_evaluation",
]);

/** Marks Claude API spans that repeat their children's token usage, so each token counts once. */
export class ClaudePlatformCanonicaliserService implements AttributeCanonicaliser {
  static create(): ClaudePlatformCanonicaliserService {
    return new ClaudePlatformCanonicaliserService();
  }

  private constructor() {}

  readonly id = "claude-platform";

  apply(ctx: ExtractorContext): void {
    if (ctx.span.instrumentationScope?.name !== CLAUDE_PLATFORM_SCOPE) {
      return;
    }

    if (COUNTED_SPAN_NAMES.has(ctx.span.name) || !this.hasTokenUsage(ctx)) {
      return;
    }

    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
    ctx.recordRule(`${this.id}:skip-request-rollup-usage`);
  }

  /** GenAICanonicaliserService runs first and may already have lifted usage into `out`. */
  private hasTokenUsage(ctx: ExtractorContext): boolean {
    return (
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] !== void 0 ||
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS] !== void 0 ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS) ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS)
    );
  }
}
