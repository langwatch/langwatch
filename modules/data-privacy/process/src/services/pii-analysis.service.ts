import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { PiiAnalysis, PiiClearing } from "../app/data-privacy.members.ts";
import type { GoogleDlpRedactionService } from "./google-dlp-redaction.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

/** Both analysis services behind the one seam the redaction passes call: main's adapter. */
export class PiiAnalysisService implements PiiAnalysis {
  static create(input: {
    dlp: GoogleDlpRedactionService;
    presidio: PresidioRedactionService;
  }): PiiAnalysisService {
    return new PiiAnalysisService(input.dlp, input.presidio);
  }

  private constructor(
    private readonly dlp: GoogleDlpRedactionService,
    private readonly presidio: PresidioRedactionService,
  ) {}

  clearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<PiiClearing> {
    return this.dlp.clear(input);
  }

  clearPresidio(input: {
    texts: string[];
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
  }): Promise<(string | null)[]> {
    return this.presidio.clear(input);
  }

  isPresidioConfigured(): Promise<boolean> {
    return this.presidio.isConfigured();
  }

  close(): Promise<void> {
    return this.dlp.close();
  }
}
