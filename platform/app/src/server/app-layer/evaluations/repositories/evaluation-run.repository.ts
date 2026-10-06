// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { Authorization } from "@langwatch/actor";
import type { EvalSummary, EvaluationRunData } from "../types";

/**
 * Optional hints used to enable ClickHouse partition pruning. The
 * `evaluation_runs` table is partitioned by `toYearWeek(ScheduledAt)`; when
 * the caller knows roughly when the evaluation was scheduled, passing a tight
 * range here lets the engine skip every other weekly partition and avoid
 * cold-storage scans.
 */
export interface GetByEvaluationIdHints {
  scheduledAt?: Date;
  /**
   * How far either side of `scheduledAt` to scan. Defaults to ±7 days, which
   * comfortably covers the typical eval lifetime (schedule → run → archive).
   */
  scheduledAtSlackMs?: number;
}

export interface GetByEvaluationIdParams {
  tenantId: string;
  evaluationId: string;
  hints?: GetByEvaluationIdHints;
}

export interface EvaluationRunRepository {
  upsert(
    data: EvaluationRunData,
    tenantId: string,
    retentionDays?: number,
  ): Promise<void>;
  upsertBatch?(
    entries: Array<{
      data: EvaluationRunData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void>;
  getByEvaluationId(
    params: GetByEvaluationIdParams,
  ): Promise<EvaluationRunData | null>;
  findByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]>;
  /**
   * The slim evaluations of a page of listed traces, read through the proof
   * (ADR-144 block C). Each row names the tenant it was read from: an
   * aggregate lists several, and two of them may hold the same trace id, so
   * the id alone does not say whose evaluation it is.
   */
  findSummariesByTraceIds(params: {
    authorization: Authorization;
    traceIds: string[];
    /** Lower bound on `ScheduledAt`, ms since epoch: the list's own window. */
    since: number;
  }): Promise<TenantEvalSummary[]>;
}

/** A listed trace's evaluation with the tenant it was read from. */
export type TenantEvalSummary = EvalSummary & {
  tenantId: string;
  traceId: string;
};

export class NullEvaluationRunRepository implements EvaluationRunRepository {
  async upsert(_data: EvaluationRunData, _tenantId: string): Promise<void> {}

  async getByEvaluationId(
    _params: GetByEvaluationIdParams,
  ): Promise<EvaluationRunData | null> {
    return null;
  }

  async findByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<EvaluationRunData[]> {
    return [];
  }

  async findSummariesByTraceIds(): Promise<TenantEvalSummary[]> {
    return [];
  }
}
