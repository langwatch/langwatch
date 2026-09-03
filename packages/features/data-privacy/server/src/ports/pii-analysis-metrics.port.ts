/**
 * What an operator can see about the external PII analysis calls.
 *
 * It is a port because the two processes that make these calls export
 * differently: the application writes into its own `prom-client` registry
 * (`platform/app/src/server/metrics.ts`), and a worker composed from packages
 * pushes over OTLP. Both write the same three series, under the same names,
 * with the same label values — a dashboard that answers "is Presidio failing"
 * must not have to know which process made the call.
 *
 * The three are one story told in three parts: how many analysis calls were
 * made and by which method, how long each batch took, and how each batch
 * ended. A process that records only the first two can show load with no way
 * to see that every call is erroring.
 */

/** How a Presidio batch ended, as the counter labels it. */
export type PiiAnalysisOutcome = "processed" | "skipped" | "error";

export abstract class PiiAnalysisMetricsPort {
  /** One external analysis call was made by `method` ("presidio", "google_dlp"). */
  abstract analysisCalled(method: string): void;
  /** One Presidio batch took `durationMs` end to end. */
  abstract analysisObserved(durationMs: number): void;
  /** One Presidio result carried `outcome`. */
  abstract analysisFinished(outcome: PiiAnalysisOutcome): void;
}
