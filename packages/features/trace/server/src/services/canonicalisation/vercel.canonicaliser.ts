import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../../ports/canonical-attributes.port";
import { canonicaliseVercelCore } from "../vercel-core.rules";
import { canonicaliseVercelIO } from "../vercel-io.rules";

export class VercelCanonicaliser implements CanonicalAttributesPort {
  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    if (!canonicaliseVercelCore(ctx)) {
      return;
    }
    canonicaliseVercelIO(ctx);
  }
}
