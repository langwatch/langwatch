/**
 * How long a project keeps its optimization traces, as the deployment's own
 * retention rules answer it. The rows live with the tracer's retention
 * policy, which this module does not own, so DSPy just asks the application.
 */
export abstract class ExperimentDspyRetentionRepository {
  abstract findTraceRetentionDays(tenantId: string): Promise<number>;
}
