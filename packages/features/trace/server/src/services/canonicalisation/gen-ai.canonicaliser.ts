import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../../ports/canonical-attributes.port";
import { canonicaliseGenAILog } from "../gen-ai-log.rules";
import { GenAiSpan } from "../gen-ai-span.rules";

export class GenAICanonicaliser implements CanonicalAttributesPort {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    GenAiSpan.canonicalise(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
