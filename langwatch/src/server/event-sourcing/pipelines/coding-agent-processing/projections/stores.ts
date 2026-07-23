import type { CodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { CodingAgentTraceSessionRecord } from "./codingAgentTraceSessions.mapProjection";
import type { SessionMetricSeriesRecord } from "./sessionMetricSeries.mapProjection";

export class CodingAgentTraceSessionAppendStore
  implements AppendStore<CodingAgentTraceSessionRecord>
{
  constructor(private readonly repository: CodingAgentTraceSessionRepository) {}

  async append(
    record: CodingAgentTraceSessionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.ensure(
      [record],
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async bulkAppend(
    records: CodingAgentTraceSessionRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensure(
      records,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}

export class SessionMetricSeriesAppendStore
  implements AppendStore<SessionMetricSeriesRecord>
{
  constructor(private readonly repository: SessionMetricSeriesRepository) {}

  async append(
    record: SessionMetricSeriesRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.ensure(
      [record],
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async bulkAppend(
    records: SessionMetricSeriesRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensure(
      records,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}
