export abstract class ExperimentDspyRetention {
  abstract getTraceRetentionDays(tenantId: string): Promise<number>;
}
