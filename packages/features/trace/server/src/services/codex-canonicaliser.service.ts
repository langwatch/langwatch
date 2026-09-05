import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../ports/canonical-attributes.port";
import { CodexLogCanonicaliserService } from "./codex-log.service";
import { CodexSpanCanonicaliserService } from "./codex-span.service";

export class CodexCanonicaliserService implements CanonicalAttributesPort {
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
