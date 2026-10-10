import { compilePiiExceptPatterns } from "@langwatch/redaction/pii";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { GoogleDlpChannel } from "../channels/google-dlp.channel.ts";
import {
  googleDlpInfoTypesFor,
  maskGoogleDlpFindings,
  PII_ANALYSIS_TEXT_BUDGET,
  type PiiClearing,
} from "../rules/pii-analysis.rules.ts";
import type { PiiAnalysisMetricsOtelService } from "./pii-analysis-metrics-otel.service.ts";

/** One text through Google DLP: main's `clearGoogleDlp`, over this module's DLP channel. */
export class GoogleDlpRedactionService {
  static create(input: {
    dlp: GoogleDlpChannel;
    disabled: boolean;
    metrics: Pick<
      PiiAnalysisMetricsOtelService,
      "analysisCalled" | "analysisObserved" | "analysisFinished"
    >;
  }): GoogleDlpRedactionService {
    return new GoogleDlpRedactionService(input.dlp, input.disabled, input.metrics);
  }

  private constructor(
    private readonly dlp: GoogleDlpChannel,
    private readonly disabled: boolean,
    private readonly metrics: Pick<
      PiiAnalysisMetricsOtelService,
      "analysisCalled" | "analysisObserved" | "analysisFinished"
    >,
  ) {}

  async clear(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
    spareNamesAndPlaces?: boolean;
  }): Promise<PiiClearing> {
    this.metrics.analysisCalled("google_dlp");
    const text = input.text.slice(0, PII_ANALYSIS_TEXT_BUDGET);
    const remaining = input.text.slice(PII_ANALYSIS_TEXT_BUDGET);

    if (this.disabled) {
      throw new Error(
        "Google DLP redaction requested but it is disabled via LANGWATCH_DISABLE_GOOGLE_DLP. " +
          "Unset that variable to re-enable DLP, or lower the data-privacy PII level " +
          "for this scope.",
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
      spareNamesAndPlaces: input.spareNamesAndPlaces ?? false,
    });

    return masked > 0
      ? { kind: "redacted", text: redacted.replace(/✳+/g, "[REDACTED]") + remaining }
      : { kind: "unchanged" };
  }

  close(): Promise<void> {
    return this.dlp.close();
  }
}
