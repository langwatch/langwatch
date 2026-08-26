import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { canonicaliseGenAILog } from "../services/gen-ai-log.service";
import { canonicaliseGenAISpan } from "../services/gen-ai-span.service";

export class GenAICanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    canonicaliseGenAISpan(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
