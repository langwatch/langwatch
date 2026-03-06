/**
 * Suite Run Service
 *
 * Reads suite run state from ClickHouse fold projections via a repository.
 */

import type { SuiteRunReadRepository } from "./repositories/suiteRunRead.repository";

export interface SuiteRunStateRow {
  suiteId: string;
  batchRunId: string;
  setId: string;
  total: number;
  progress: number;
  completedCount: number;
  failedCount: number;
  erroredCount: number;
  cancelledCount: number;
  passRateBps: number | null;
  status: string;
  scenarioIds: string[];
  targets: Array<{ id: string; type: string }>;
  repeatCount: number;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SuiteRunItemRow {
  scenarioRunId: string;
  scenarioId: string;
  targetReferenceId: string;
  targetType: string;
  status: string;
  verdict: string | null;
  durationMs: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
}

export class SuiteRunService {
  constructor(private readonly repository: SuiteRunReadRepository) {}

  async getSuiteRunState(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunStateRow | null> {
    return this.repository.getRunState(params);
  }

  async getSuiteRunHistory(params: {
    suiteId: string;
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }> {
    return this.repository.getRunHistory(params);
  }

  async getAllSuiteRunHistory(params: {
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }> {
    return this.repository.getAllRunHistory(params);
  }

  async getRunItems(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunItemRow[]> {
    return this.repository.getRunItems(params);
  }

  async getRunByIdempotencyKey(params: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<SuiteRunStateRow | null> {
    return this.repository.getRunByIdempotencyKey(params);
  }
}
