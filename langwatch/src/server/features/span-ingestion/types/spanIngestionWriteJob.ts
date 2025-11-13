import type { SpanIngestionWriteJobData } from "./spanIngestionWriteJobData";

export interface SpanIngestionWriteJob {
  tenantId: string;
  spanData: SpanIngestionWriteJobData;
  collectedAtUnixMs: number;
}
