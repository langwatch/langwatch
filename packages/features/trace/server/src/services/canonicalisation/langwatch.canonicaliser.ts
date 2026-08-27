import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../../ports/canonical-attributes.port";
import { canonicaliseLangWatchIdentity } from "../langwatch-identity.rules";
import { canonicaliseLangWatchMetadata } from "../langwatch-metadata.rules";
import { canonicaliseLangWatchMetrics } from "../langwatch-metrics.rules";
import { canonicaliseLangWatchValues } from "../langwatch-value.rules";

export class LangWatchCanonicaliser implements CanonicalAttributesPort {
  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    canonicaliseLangWatchIdentity(ctx);
    canonicaliseLangWatchMetadata(ctx);
    canonicaliseLangWatchValues(ctx);
    canonicaliseLangWatchMetrics(ctx);
  }
}
