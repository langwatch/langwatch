import type { CanonicalAttributesPort, ExtractorContext } from "../ports/canonical-attributes.port";
import { canonicaliseVercelCore } from "../rules/vercel-core.rules";
import { canonicaliseVercelIO } from "../rules/vercel-io.rules";

export class VercelCanonicaliserService implements CanonicalAttributesPort {
  static create(): VercelCanonicaliserService {
    return new VercelCanonicaliserService();
  }

  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    if (!canonicaliseVercelCore(ctx)) {
      return;
    }

    canonicaliseVercelIO(ctx);
  }
}
