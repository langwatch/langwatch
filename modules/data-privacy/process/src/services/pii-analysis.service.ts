import type { PiiLevel } from "@langwatch/data-privacy-contract";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { PiiClearing } from "../rules/pii-analysis.rules.ts";
import type { GoogleDlpRedactionService } from "./google-dlp-redaction.service.ts";
import type { PiiRedactionModelService } from "./pii-redaction-model.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

/** Both analysis services behind the one seam the redaction passes call: main's adapter. */
export class PiiAnalysisService {
  static create(input: {
    dlp: GoogleDlpRedactionService;
    presidio: PresidioRedactionService;
    model: PiiRedactionModelService;
  }): PiiAnalysisService {
    return new PiiAnalysisService(input.dlp, input.presidio, input.model);
  }

  private constructor(
    private readonly dlp: GoogleDlpRedactionService,
    private readonly presidio: PresidioRedactionService,
    private readonly model: PiiRedactionModelService,
  ) {}

  clearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
    spareNamesAndPlaces?: boolean;
  }): Promise<PiiClearing> {
    return this.dlp.clear(input);
  }

  /**
   * The model first for an allowlisted organization whose resolved policy is strict; Presidio
   * for everyone else and on failure.
   */
  async clearPresidio(input: {
    texts: string[];
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
    resolvedPiiLevel?: PiiLevel | undefined;
    spareNamesAndPlaces?: readonly boolean[] | undefined;
  }): Promise<(string | null)[]> {
    const cleared = await this.model.findClearing(input);
    if (cleared) return cleared;

    return this.presidio.clear(input);
  }

  isPresidioConfigured(): Promise<boolean> {
    return this.presidio.isConfigured();
  }

  close(): Promise<void> {
    return this.dlp.close();
  }
}
