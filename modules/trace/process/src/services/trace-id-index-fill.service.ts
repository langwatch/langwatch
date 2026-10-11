import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { type FeatureFlagApi, idIndexFlagKey } from "@langwatch/feature-flag-contract";

import type { TraceIdIndexFillRepository } from "../repositories/trace-id-index-fill.repository.ts";
import { TRACE_ID_INDEX_OWNER } from "./trace-id-index-flags.service.ts";

/**
 * The `trace:fill-id-indexes` step: fills trace's id indexes per ClickHouse target, raises their
 * retention there, then sets `clickhouse_id_index_trace_<target>` (id-index plan §3).
 */
export class TraceIdIndexFillService {
  private constructor(
    private readonly indexes: TraceIdIndexFillRepository,
    private readonly dataRetention: DataRetentionApi,
    private readonly featureFlags: FeatureFlagApi,
  ) {}

  static create({
    indexes,
    dataRetention,
    featureFlags,
  }: {
    indexes: TraceIdIndexFillRepository;
    dataRetention: DataRetentionApi;
    featureFlags: FeatureFlagApi;
  }): TraceIdIndexFillService {
    return new TraceIdIndexFillService(indexes, dataRetention, featureFlags);
  }

  fill({
    checkpoint,
    dryRun,
    signal,
  }: {
    checkpoint: IdIndexFillCheckpoint;
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<IdIndexFillReport> {
    return this.indexes.fill({
      checkpoint,
      dryRun,
      signal,
      beforeFlag: async ({ organizationId, indexes }) => {
        if (indexes.length === 0) return;
        await this.dataRetention.raiseIdIndexRetention({
          ...(organizationId === undefined ? {} : { organizationId }),
          indexes,
        });
      },
      setFlag: ({ target }) =>
        this.featureFlags.setEnabled({
          key: idIndexFlagKey({ owner: TRACE_ID_INDEX_OWNER, target }),
          enabled: true,
          lastEditedBy: null,
        }),
    });
  }
}
