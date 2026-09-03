export abstract class ExperimentDspyRetentionPort {
  abstract getTraceRetentionDays(tenantId: string): Promise<number>;
}
