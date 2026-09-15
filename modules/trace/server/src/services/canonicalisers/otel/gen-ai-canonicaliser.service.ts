import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "../canonical-attributes.service.ts";
import { canonicaliseGenAILog } from "../../../rules/gen-ai-log.rules.ts";
import { GenAiSpanService } from "./gen-ai-span.service.ts";

const genAiSpanService = GenAiSpanService.create();

export class GenAICanonicaliserService implements AttributeCanonicaliser {
  static create(): GenAICanonicaliserService {
    return new GenAICanonicaliserService();
  }

  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    genAiSpanService.canonicalise(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
