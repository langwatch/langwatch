import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

/**
 * The project read a policy resolution is built from.
 *
 * A policy is inherited down organization → team → department → project, and
 * every id on that chain is on the project row read with its team. That one
 * read is the only thing the resolution needs, so it is named here rather than
 * taken as a whole `ProjectApi` — which would put the project write graph
 * and, through it, an organization service and an authz service in a process
 * that only redacts spans. `ProjectApi` and `ProjectMetadataService` both
 * satisfy this.
 */
export interface DataPrivacyProject {
  getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The one question the ingestion paths ask of data privacy.
 *
 * `DataPrivacyResolutionService` answers it, and so does the wider
 * `DataPrivacyService` that composes it. Naming it is what lets the span
 * content-drop and PII-redaction services be composed by a process that can
 * resolve a policy but cannot write one.
 */
export interface DataPrivacyResolution {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
}

/** How a Presidio batch ended, as the counter labels it. */
export type PiiAnalysisOutcome = "processed" | "skipped" | "error";

/**
 * What an operator can see about the external PII analysis calls.
 *
 * It is infrastructure because the two processes that make these calls export
 * differently: the application writes into its own `prom-client` registry,
 * and a worker composed from packages pushes over OTLP. Both write the same
 * three series, under the same names, with the same label values — a
 * dashboard that answers "is Presidio failing" must not have to know which
 * process made the call.
 */
export interface PiiAnalysisMetrics {
  /** One external analysis call was made by `method` ("presidio", "google_dlp"). */
  analysisCalled(method: string): void;
  /** One Presidio batch took `durationMs` end to end. */
  analysisObserved(durationMs: number): void;
  /** One Presidio result carried `outcome`. */
  analysisFinished(outcome: PiiAnalysisOutcome): void;
}

/**
 * The external PII analysis capability, as this feature asks for it.
 *
 * It is infrastructure rather than an interface here because a process
 * composes it: the application builds a Google DLP client and a Presidio
 * HTTP client inside its own runtime, and a worker composed from packages
 * builds its own. Neither belongs to this feature — one of them drags a gRPC
 * channel and a generated proto tree — so what this feature names is the
 * capability, not either client.
 *
 * `close` is here because the DLP client holds a gRPC channel: a composition
 * root that builds one has to be able to give it back, and the only handle it
 * has is this interface.
 */
export interface PiiAnalysis {
  tryClearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<string | null>;
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
   * The policy's do-not-redact exception patterns (raw source strings). Only
   * `batchClearPII`'s google_dlp branch actually reads this: DLP
   * findings carry the matched text, so a finding fully covered by an
   * exception can be vetoed before masking.
   * `mainMethod: "presidio"` — the one every strict/custom analysis-service
   * call currently uses — ignores this field entirely: Presidio's batch
   * endpoint returns pre-anonymized text with no positions or matched text to
   * veto against.
   */
  exceptPatterns?: readonly string[];
};
