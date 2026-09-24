import { canonicaliseLangWatchIdentity } from "../rules/langwatch-identity.rules.ts";
import { canonicaliseLangWatchMetadata } from "../rules/langwatch-metadata.rules.ts";
import { canonicaliseLangWatchMetrics } from "../rules/langwatch-metrics.rules.ts";
import { canonicaliseLangWatchValues } from "../rules/langwatch-value.rules.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonical-attributes.service.ts";

export class LangWatchCanonicaliserService implements AttributeCanonicaliser {
  static create(): LangWatchCanonicaliserService {
    return new LangWatchCanonicaliserService();
  }

  private constructor() {}

  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    canonicaliseLangWatchIdentity(ctx);
    canonicaliseLangWatchMetadata(ctx);
    canonicaliseLangWatchValues(ctx);
    canonicaliseLangWatchMetrics(ctx);
  }
}
