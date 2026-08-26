import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";
import { canonicaliseLangWatchIdentity } from "../services/langwatch-identity.service";
import { canonicaliseLangWatchMetadata } from "../services/langwatch-metadata.service";
import { canonicaliseLangWatchMetrics } from "../services/langwatch-metrics.service";
import { canonicaliseLangWatchValues } from "../services/langwatch-value.service";

export class LangWatchCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    canonicaliseLangWatchIdentity(ctx);
    canonicaliseLangWatchMetadata(ctx);
    canonicaliseLangWatchValues(ctx);
    canonicaliseLangWatchMetrics(ctx);
  }
}
