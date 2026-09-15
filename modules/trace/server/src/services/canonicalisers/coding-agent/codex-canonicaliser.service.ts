import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "../canonical-attributes.service.ts";
import { CodexLogCanonicaliserService } from "./codex-log.service.ts";
import { CodexSpanCanonicaliserService } from "./codex-span.service.ts";

export class CodexCanonicaliserService implements AttributeCanonicaliser {
  static create(): CodexCanonicaliserService {
    return new CodexCanonicaliserService();
  }

  readonly id = "codex";
  private readonly logCanonicaliser = CodexLogCanonicaliserService.create();
  private readonly spanCanonicaliser = CodexSpanCanonicaliserService.create();

  apply(ctx: ExtractorContext): void {
    this.spanCanonicaliser.apply(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    this.logCanonicaliser.apply(ctx);
  }
}
