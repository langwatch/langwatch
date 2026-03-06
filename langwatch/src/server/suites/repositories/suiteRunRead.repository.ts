import type { SuiteRunStateRow, SuiteRunItemRow } from "../suite-run.service";

export interface SuiteRunReadRepository {
  getRunState(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunStateRow | null>;

  getRunHistory(params: {
    suiteId: string;
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }>;

  getAllRunHistory(params: {
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }>;

  getRunItems(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunItemRow[]>;

  getRunByIdempotencyKey(params: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<SuiteRunStateRow | null>;
}
