import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "./canonicalAttributes.ts";
import { canonicaliseGenAILog } from "./genAiLog.ts";
import { GenAiSpanService } from "./genAiSpan.ts";

const genAiSpanService = GenAiSpanService.create();

export class GenAICanonicaliserService implements AttributeCanonicaliser {
  static create(): GenAICanonicaliserService {
    return new GenAICanonicaliserService();
  }

  private constructor() {}

  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    genAiSpanService.canonicalise(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    canonicaliseGenAILog(ctx);
  }
}
