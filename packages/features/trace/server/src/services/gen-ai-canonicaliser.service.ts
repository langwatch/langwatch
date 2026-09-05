import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { canonicaliseGenAILog } from "../rules/gen-ai-log.rules";
import { GenAiSpanService } from "./gen-ai-span.service";

const genAiSpanService = GenAiSpanService.create();

export class GenAICanonicaliserService implements CanonicalAttributesPort {
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
