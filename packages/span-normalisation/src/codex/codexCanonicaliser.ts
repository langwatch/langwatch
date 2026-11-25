import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "../canonicalAttributes.ts";
import { CodexLogCanonicaliserService } from "./codexLog.ts";
import { type CodexScopes, CodexSpanCanonicaliserService } from "./codexSpan.ts";

export class CodexCanonicaliserService implements AttributeCanonicaliser {
  static create({ scopes }: { scopes: CodexScopes }): CodexCanonicaliserService {
    return new CodexCanonicaliserService(scopes);
  }

  private constructor(scopes: CodexScopes) {
    this.spanCanonicaliser = CodexSpanCanonicaliserService.create({ scopes });
  }

  readonly id = "codex";
  private readonly logCanonicaliser = CodexLogCanonicaliserService.create();
  private readonly spanCanonicaliser: CodexSpanCanonicaliserService;

  apply(ctx: ExtractorContext): void {
    this.spanCanonicaliser.apply(ctx);
  }

  applyLog(ctx: LogExtractorContext): void {
    this.logCanonicaliser.apply(ctx);
  }
}
