/**
 * Lifts the model off Grok's log records (ADR-192). Grok sends logs only, so a turn has no
 * model-call span to name its model; every turn record carries it as `model` instead.
 */

import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "./canonicalAttributes.ts";
import { isNonEmptyString } from "./canonicalGuard.ts";

/** Grok's fixed instrumentation scope; it ignores OTEL_RESOURCE_ATTRIBUTES, so this never moves. */
const GROK_SCOPE_NAME = "ai.xai.grok_code";

/** Canonicalises Grok's log records: lifts each turn record's `model` onto `langwatch.model`. */
export class GrokCanonicaliserService implements AttributeCanonicaliser {
  static create(): GrokCanonicaliserService {
    return new GrokCanonicaliserService();
  }

  private constructor() {}

  readonly id = "grok";

  // Grok emits no spans.
  apply(_ctx: ExtractorContext): void {}

  applyLog(ctx: LogExtractorContext): void {
    if (ctx.bag.scopeName !== GROK_SCOPE_NAME) return;

    const model = ctx.bag.attrs.get("model");
    if (!isNonEmptyString(model)) return;

    ctx.setAttr("langwatch.model", model);
    ctx.recordRule("grok:log.model");
  }
}
