import { ATTR_KEYS } from "../attributeKeys.ts";
import {
  type AttributeCanonicaliser,
  type ExtractorContext,
  takeAttribute,
} from "../canonicalAttributes.ts";
import { asNumber } from "../canonicalGuard.ts";
import { CLAUDE_PLATFORM_SPAN_NAMES, isClaudePlatformScope } from "./claudePlatformSpans.ts";

const RULE_PREFIX = "anthropic";

/**
 * The Claude SDK and Claude API spans, after the GenAI pass has read their `gen_ai.*` usage.
 * Within one Messages request only `anthropic.messages.create` counts, with its compaction
 * usage; Managed Agents model requests count. Spec: claude-platform-telemetry.feature.
 */
export class AnthropicCanonicaliserService implements AttributeCanonicaliser {
  static create(): AnthropicCanonicaliserService {
    return new AnthropicCanonicaliserService();
  }

  private constructor() {}

  readonly id = RULE_PREFIX;

  apply(ctx: ExtractorContext): void {
    this.liftToolResult(ctx);
    if (!isClaudePlatformScope(ctx.span.instrumentationScope.name)) {
      return;
    }

    switch (ctx.span.name) {
      case CLAUDE_PLATFORM_SPAN_NAMES.MESSAGES_CREATE:
        this.liftCacheCreationTtlSplit(ctx);
        this.addCompactionUsage(ctx);
        return;
      case CLAUDE_PLATFORM_SPAN_NAMES.MODEL_REQUEST:
        if (!this.isManagedAgentsModelRequest(ctx)) {
          this.markCountedElsewhere(ctx, "messages-model-request");
        }
        return;
      case CLAUDE_PLATFORM_SPAN_NAMES.COMPACTION:
        this.markCountedElsewhere(ctx, "compaction");
        return;
      default:
        return;
    }
  }

  /** A tool span's result as the tool-call result every output reader already knows. */
  private liftToolResult(ctx: ExtractorContext): void {
    const result = takeAttribute(ctx.bag.attrs, ATTR_KEYS.ANTHROPIC_TOOL_RESULT_CONTENT);
    if (result === void 0 || result === null) {
      return;
    }

    ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT, result);
    ctx.recordRule(`${RULE_PREFIX}:tool_result.content->tool.call.result`);
  }

  /** The cache writes by TTL, so the one-hour writes price at their own rate. */
  private liftCacheCreationTtlSplit(ctx: ExtractorContext): void {
    const lifts: [string, string][] = [
      [
        ATTR_KEYS.ANTHROPIC_USAGE_CACHE_CREATION_5M_INPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_5M_INPUT_TOKENS,
      ],
      [
        ATTR_KEYS.ANTHROPIC_USAGE_CACHE_CREATION_1H_INPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_1H_INPUT_TOKENS,
      ],
    ];
    for (const [source, target] of lifts) {
      const tokens = asNumber(takeAttribute(ctx.bag.attrs, source));
      if (tokens !== null && tokens > 0) {
        ctx.setAttrIfAbsent(target, tokens);
        ctx.recordRule(`${RULE_PREFIX}:${source}`);
      }
    }
  }

  /** Compaction usage is outside `gen_ai.usage.*`, so the request's counts take it in. */
  private addCompactionUsage(ctx: ExtractorContext): void {
    const additions: [string, string][] = [
      [ATTR_KEYS.ANTHROPIC_USAGE_COMPACTION_INPUT_TOKENS, ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS],
      [ATTR_KEYS.ANTHROPIC_USAGE_COMPACTION_OUTPUT_TOKENS, ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS],
    ];
    for (const [source, target] of additions) {
      const compaction = asNumber(ctx.bag.attrs.get(source));
      if (compaction === null || compaction <= 0) {
        continue;
      }

      const current = asNumber(ctx.out[target] ?? ctx.bag.attrs.get(target)) ?? 0;
      takeAttribute(ctx.bag.attrs, target);
      ctx.setAttr(target, current + compaction);
      ctx.recordRule(`${RULE_PREFIX}:${source}`);
    }
  }

  /** Managed Agents model requests name an operation; Messages API ones repeat their parent. */
  private isManagedAgentsModelRequest(ctx: ExtractorContext): boolean {
    return (
      ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME] !== void 0 ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME)
    );
  }

  private markCountedElsewhere(ctx: ExtractorContext, reason: string): void {
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
    ctx.recordRule(`${RULE_PREFIX}:skip-${reason}-usage`);
  }
}
