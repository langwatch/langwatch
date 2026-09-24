import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

/**
 * The project row for policy resolution: inherited down
 * org→team→department→project chain.
 */
export interface DataPrivacyProject {
  getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The one question ingestion paths ask of data privacy — answered by both
 * `DataPrivacyResolutionService` and the wider `DataPrivacyService`, so a
 * process can compose content-drop/PII-redaction while only resolving policy.
 */
export interface DataPrivacyResolution {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
}

/** How a Presidio batch ended, as the counter labels it. */
export type PiiAnalysisOutcome = "processed" | "skipped" | "error";

/**
 * What an operator can see about external PII analysis calls. Members interface
 * because two processes export differently (prom-client vs OTLP) but write
 * identical series.
 */
export interface PiiAnalysisMetrics {
  /** One external analysis call was made by `method` ("presidio", "google_dlp"). */
  analysisCalled(method: string): void;
  /** One Presidio batch took `durationMs` end to end. */
  analysisObserved(durationMs: number): void;
  /** One Presidio result carried `outcome`. */
  analysisFinished(outcome: PiiAnalysisOutcome): void;
}

/** One text through an analysis service: its redacted form, or left as it was. */
export type PiiClearing = { kind: "redacted"; text: string } | { kind: "unchanged" };

/**
 * External PII analysis capability: members interface because processes
 * compose clients differently; close is needed for DLP's gRPC channel.
 */
export interface PiiAnalysis {
  clearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<PiiClearing>;
  clearPresidio(
    texts: string[],
    piiRedactionLevel: PIIRedactionLevel,
    entities?: readonly string[],
  ): Promise<(string | null)[]>;
  close(): Promise<void>;
}

export type PIICheckOptions = {
  piiRedactionLevel: PIIRedactionLevel;
  enforced?: boolean;
  mainMethod?: "google_dlp" | "presidio";
  /**
   * Explicit analyzer entity names (uppercase, e.g. "PERSON") to detect,
   * overriding the level's default set. The custom PII level uses this to scan
   * only the analysis-service identifiers a team selected.
   */
  entities?: readonly string[];
  /**
   * Do-not-redact exception patterns (raw source strings). Only google_dlp
   * branch reads them; presidio ignores this field entirely.
   */
  exceptPatterns?: readonly string[];
};
