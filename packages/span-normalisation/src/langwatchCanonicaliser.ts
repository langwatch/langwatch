import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";
import { canonicaliseLangWatchIdentity } from "./langwatchIdentity.ts";
import { canonicaliseLangWatchMetadata } from "./langwatchMetadata.ts";
import { canonicaliseLangWatchMetrics } from "./langwatchMetrics.ts";
import { canonicaliseLangWatchValues } from "./langwatchValue.ts";

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
