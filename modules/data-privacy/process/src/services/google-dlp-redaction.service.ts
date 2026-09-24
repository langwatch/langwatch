import { compilePiiExceptPatterns } from "@langwatch/redaction/pii";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { PiiAnalysisMetrics, PiiClearing } from "../app/data-privacy.members.ts";
import type { GoogleDlpChannel } from "../channels/google-dlp.channel.ts";
import {
  googleDlpInfoTypesFor,
  maskGoogleDlpFindings,
  PII_ANALYSIS_TEXT_BUDGET,
} from "../rules/pii-analysis.rules.ts";

/** One text through Google DLP: main's `clearGoogleDlp`, over this module's DLP channel. */
export class GoogleDlpRedactionService {
  static create(input: {
    dlp: GoogleDlpChannel;
    disabled: boolean;
    metrics: PiiAnalysisMetrics;
  }): GoogleDlpRedactionService {
    return new GoogleDlpRedactionService(input.dlp, input.disabled, input.metrics);
  }

  private constructor(
    private readonly dlp: GoogleDlpChannel,
    private readonly disabled: boolean,
    private readonly metrics: PiiAnalysisMetrics,
  ) {}

  async clear(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<PiiClearing> {
    this.metrics.analysisCalled("google_dlp");
    const text = input.text.slice(0, PII_ANALYSIS_TEXT_BUDGET);
    const remaining = input.text.slice(PII_ANALYSIS_TEXT_BUDGET);

    if (this.disabled) {
      throw new Error(
        "Google DLP redaction requested but it is disabled via LANGWATCH_DISABLE_GOOGLE_DLP. Unset that variable to re-enable DLP, or lower the data-privacy PII level for this scope.",
      );
    }
    const findings = await this.dlp.inspect({
      text,
      infoTypes: googleDlpInfoTypesFor(input.piiRedactionLevel),
    });
    const { redacted, masked } = maskGoogleDlpFindings({
      text,
      findings,
      exceptions: compilePiiExceptPatterns(input.exceptPatterns ?? []),
    });

    return masked > 0
      ? { kind: "redacted", text: redacted.replace(/✳+/g, "[REDACTED]") + remaining }
      : { kind: "unchanged" };
  }

  close(): Promise<void> {
    return this.dlp.close();
  }
}
