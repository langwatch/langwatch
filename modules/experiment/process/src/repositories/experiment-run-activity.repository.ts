/** The runs executing now, per project and across the deployment, for the default concurrency. */
export abstract class ExperimentRunActivityRepository {
  /** Counts the run as active until `expiresAt`, unless it is marked inactive first. */
  abstract markActive(input: {
    projectId: string;
    runId: string;
    expiresAt: number;
  }): Promise<void>;
  /** Stops counting the run. Answers quietly for a run never marked. */
  abstract markInactive(input: { projectId: string; runId: string }): Promise<void>;
  /**
   * Marks the run active until `expiresAt` and answers the other runs active in the project and in
   * every project, in one atomic step so runs claiming at once each see the ones before them.
   */
  abstract claim(input: {
    projectId: string;
    runId: string;
    now: number;
    expiresAt: number;
  }): Promise<{ project: number; global: number }>;
}
