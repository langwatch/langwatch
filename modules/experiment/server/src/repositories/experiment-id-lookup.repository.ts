/** Looks up the experiment a run belongs to, for cross-pipeline wiring. */
export abstract class ExperimentIdLookupRepository {
  /** The run's ExperimentId, or null if the run has no row yet. */
  abstract tryFindExperimentId(input: { tenantId: string; runId: string }): Promise<string | null>;
}
