import type { CodingAgentSessionEventsRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import type { CodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { CodingAgentSessionEventRecord } from "./codingAgentSessionEvents.mapProjection";
import type { CodingAgentTraceSessionRecord } from "./codingAgentTraceSessions.mapProjection";
import type { SessionMetricSeriesRecord } from "./sessionMetricSeries.mapProjection";

/** A repository that writes a batch of records under one retention stamp. */
interface RetentionAwareEnsurePort<TRecord> {
  ensure(records: TRecord[], retentionDays: number): Promise<void>;
}

/**
 * Appends records through a repository's retention-stamped `ensure`.
 *
 * Every coding-agent map projection writes the same way: one `ensure` per
 * batch, stamped with the tenant's trace retention and falling back to the
 * platform default when the resolver produced none. Retention is default-on,
 * so that fallback is load-bearing, and holding it in one place is what keeps
 * a change to it from having to be repeated once per store.
 */
class EnsureAppendStore<TRecord> implements AppendStore<TRecord> {
  constructor(private readonly repository: RetentionAwareEnsurePort<TRecord>) {}

  async append(
    record: TRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.bulkAppend([record], context);
  }

  async bulkAppend(
    records: TRecord[],
    context: ProjectionStoreContext | BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensure(
      records,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}

export class CodingAgentTraceSessionAppendStore extends EnsureAppendStore<CodingAgentTraceSessionRecord> {
  constructor(repository: CodingAgentTraceSessionRepository) {
    super(repository);
  }
}

export class CodingAgentSessionEventsAppendStore extends EnsureAppendStore<CodingAgentSessionEventRecord> {
  constructor(repository: CodingAgentSessionEventsRepository) {
    super(repository);
  }
}

export class SessionMetricSeriesAppendStore extends EnsureAppendStore<SessionMetricSeriesRecord> {
  constructor(repository: SessionMetricSeriesRepository) {
    super(repository);
  }
}
