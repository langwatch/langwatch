import type { TraceProjectionJobData } from "./traceProjectionJobData";

export interface TraceProjectionJob {
  tenantId: string;
  traceId: string;
  jobData: TraceProjectionJobData;
}

