/** Restates every source's input count as the fresh remainder once its cache buckets are known. */

import { ATTR_KEYS } from "./attributeKeys.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";
import { isInputRestatedAsFresh, restateInputAsFresh } from "./canonicalExtraction.ts";
import { asNumber } from "./canonicalGuard.ts";

const RULE_PREFIX = "fresh-input";

/** The LangWatch REST collector's spans carry the SDK metrics, whose input count is fresh. */
const FRESH_INPUT_SCOPES: ReadonlySet<string> = new Set(["langwatch.rest.collector"]);

/**
 * The GenAI conventions count the cache inside `gen_ai.usage.input_tokens`, so a span with cache
 * buckets has its input restated, unless a source marked it fresh or its stated total adds up
 * only with the input taken as fresh. Rule: specs/trace-processing/fresh-input-tokens.feature.
 */
export class FreshInputCanonicaliserService implements AttributeCanonicaliser {
  static create(): FreshInputCanonicaliserService {
    return new FreshInputCanonicaliserService();
  }

  private constructor() {}

  readonly id = RULE_PREFIX;

  apply(ctx: ExtractorContext): void {
    if (isInputRestatedAsFresh(ctx)) {
      return;
    }

    const sentFresh =
      FRESH_INPUT_SCOPES.has(ctx.span.instrumentationScope.name) ||
      this.totalCountsInputAsFresh(ctx);
    if (sentFresh) {
      return;
    }

    restateInputAsFresh(ctx, { ruleId: `${RULE_PREFIX}:usage.input_tokens(fresh)` });
  }

  /** Whether the stated total equals fresh input, output and cache, so the input excludes cache. */
  private totalCountsInputAsFresh(ctx: ExtractorContext): boolean {
    const read = (key: string): number | null =>
      asNumber(ctx.out[key] !== void 0 ? ctx.out[key] : ctx.bag.attrs.get(key));
    const total = read(ATTR_KEYS.GEN_AI_USAGE_TOTAL_TOKENS);
    const input = read(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS);
    const output = read(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS);
    if (total === null || input === null || output === null) {
      return false;
    }

    const cached =
      (read(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS) ?? 0) +
      (read(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS) ?? 0);

    return cached > 0 && total === input + output + cached;
  }
}
