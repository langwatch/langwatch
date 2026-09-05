import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { canonicaliseGenAILog } from "../rules/gen-ai-log.rules";
import { GenAiSpan } from "../services/gen-ai-span.service";

export class GenAICanonicaliser implements CanonicalAttributesPort {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    GenAiSpan.canonicalise(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
