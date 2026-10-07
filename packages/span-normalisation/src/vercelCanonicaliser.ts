import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";
import { canonicaliseVercelCore } from "./vercelCore.ts";
import { canonicaliseVercelIO } from "./vercelIo.ts";

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
