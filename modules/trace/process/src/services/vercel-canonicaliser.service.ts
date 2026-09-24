import { canonicaliseVercelCore } from "../rules/vercel-core.rules.ts";
import { canonicaliseVercelIO } from "../rules/vercel-io.rules.ts";
import type { AttributeCanonicaliser, ExtractorContext } from "./canonical-attributes.service.ts";

export class VercelCanonicaliserService implements AttributeCanonicaliser {
  static create(): VercelCanonicaliserService {
    return new VercelCanonicaliserService();
  }

  private constructor() {}

  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    if (!canonicaliseVercelCore(ctx)) {
      return;
    }

    canonicaliseVercelIO(ctx);
  }
}
