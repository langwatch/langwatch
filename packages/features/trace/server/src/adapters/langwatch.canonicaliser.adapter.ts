import type { CanonicalAttributesPort, ExtractorContext } from "../ports/canonical-attributes.port";
import { canonicaliseLangWatchIdentity } from "../rules/langwatch-identity.rules";
import { canonicaliseLangWatchMetadata } from "../rules/langwatch-metadata.rules";
import { canonicaliseLangWatchMetrics } from "../rules/langwatch-metrics.rules";
import { canonicaliseLangWatchValues } from "../rules/langwatch-value.rules";

export class LangWatchCanonicaliser implements CanonicalAttributesPort {
  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    canonicaliseLangWatchIdentity(ctx);
    canonicaliseLangWatchMetadata(ctx);
    canonicaliseLangWatchValues(ctx);
    canonicaliseLangWatchMetrics(ctx);
  }
}
