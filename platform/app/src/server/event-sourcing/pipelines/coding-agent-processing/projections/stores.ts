import type { CodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { retentionDaysFrom } from "../../shared/analyticsStoreBase";
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
      retentionDaysFrom(context, "traces"),
    );
  }

  async bulkAppend(
    records: CodingAgentTraceSessionRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensure(records, retentionDaysFrom(context, "traces"));
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
      retentionDaysFrom(context, "traces"),
    );
  }

  async bulkAppend(
    records: SessionMetricSeriesRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensure(records, retentionDaysFrom(context, "traces"));
  }
}
