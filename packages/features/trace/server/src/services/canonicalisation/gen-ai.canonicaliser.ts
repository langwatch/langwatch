import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../../ports/canonical-attributes.port";
import { canonicaliseGenAILog } from "../gen-ai-log.rules";
import { canonicaliseGenAISpan } from "../gen-ai-span.rules";

export class GenAICanonicaliser implements CanonicalAttributesPort {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    canonicaliseGenAISpan(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
