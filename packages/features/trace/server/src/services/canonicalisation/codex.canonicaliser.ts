import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../../ports/canonical-attributes.port";
import { CodexLogCanonicaliser } from "../codex-log.rules";
import { CodexSpanCanonicaliser } from "../codex-span.rules";

export class CodexCanonicaliser implements CanonicalAttributesPort {
  readonly id = "codex";
  private readonly logCanonicaliser = new CodexLogCanonicaliser();
  private readonly spanCanonicaliser = new CodexSpanCanonicaliser();

  apply(ctx: ExtractorContext): void {
    this.spanCanonicaliser.apply(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    this.logCanonicaliser.apply(ctx);
  }
}
