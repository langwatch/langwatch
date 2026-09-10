import type { CanonicalAttributesPort, ExtractorContext } from "./canonical-attributes.service.ts";
import { canonicaliseVercelCore } from "../../rules/vercel-core.rules.ts";
import { canonicaliseVercelIO } from "../../rules/vercel-io.rules.ts";

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
