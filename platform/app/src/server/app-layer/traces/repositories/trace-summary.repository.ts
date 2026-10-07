// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { Authorization } from "@langwatch/actor";
import type { TraceSummaryData } from "../types";

export interface FindByTraceIdOptions {
  /**
   * Approximate trace timestamp (ms since epoch). When provided, the repo
   * narrows the scan to a window around it so ClickHouse can prune
   * partitions instead of scanning across all of cold storage. The value
   * is a hint — drift up to a few hours is fine.
   */
  occurredAtMs?: number;

  /**
   * An explicit time bound, applied verbatim with NO internal miss fallback —
   * the caller declared the width (the fold's `options.readWindow`) and owns
   * the retry (the fold executor re-reads without the window on a miss).
   * Takes precedence over `occurredAtMs`, which exists for callers that only
   * hold a point-in-time hint and want the repository to widen it AND recover
   * a miss itself (resolve the trace's real OccurredAt, bound a retry).
   */
  window?: { fromMs: number; toMs: number };
}

/**
 * A single-trace summary read. The proof fences the tenants the read may
 * see (ADR-144 block C); the repository never names one of its own.
 */
export type FindByTraceIdParams = {
  authorization: Authorization;
  traceId: string;
} & FindByTraceIdOptions;

/**
 * A summary as one read found it, with the tenant it was read from. A proof
 * may span several tenants (an aggregate's members), and two of them may
 * hold the same trace id, so the row says whose it is; the reads that follow
 * it on a detail page are narrowed to that tenant (ADR-144 block F).
 */
export type TraceSummaryRead = TraceSummaryData & { tenantId: string };

export interface TraceSummaryRepository {
  upsert(
    data: TraceSummaryData,
    tenantId: string,
    retentionDays?: number,
  ): Promise<void>;
  upsertBatch?(
    entries: Array<{
      data: TraceSummaryData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void>;
  findByTraceId(params: FindByTraceIdParams): Promise<TraceSummaryRead | null>;
  /**
   * The tenant that holds a trace, of those the proof reads: the first by
   * tenant id when several do, the same pick the heavy read makes. A light
   * sort-key seek, for a caller that needs only whose trace it is.
   */
  findTenantIdByTraceId(params: {
    authorization: Authorization;
    traceId: string;
  }): Promise<string | null>;
}

export class NullTraceSummaryRepository implements TraceSummaryRepository {
  async upsert(_data: TraceSummaryData, _tenantId: string): Promise<void> {}

  async findByTraceId(
    _params: FindByTraceIdParams,
  ): Promise<TraceSummaryRead | null> {
    return null;
  }

  async findTenantIdByTraceId(_params: {
    authorization: Authorization;
    traceId: string;
  }): Promise<string | null> {
    return null;
  }
}
