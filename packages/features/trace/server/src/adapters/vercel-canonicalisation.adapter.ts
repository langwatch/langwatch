import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";
import { canonicaliseVercelCore } from "../services/vercel-core.service";
import { canonicaliseVercelIO } from "../services/vercel-io.service";

export class VercelCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    if (!canonicaliseVercelCore(ctx)) {
      return;
    }
    canonicaliseVercelIO(ctx);
  }
}
