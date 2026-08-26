import type {
  AppendStore,
  BulkAppendContext,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CodingAgentSessionEventRecord } from "./codingAgentSessionEvents.mapProjection";
import type { CodingAgentTraceSessionRecord } from "./codingAgentTraceSessions.mapProjection";
import type { SessionMetricSeriesRecord } from "./sessionMetricSeries.mapProjection";

/**
 * Appends records through Coding Agent's named projection-persistence adapter.
 *
 * Every coding-agent map projection writes the same way: one `ensure` per
 * batch, stamped with the tenant's trace retention and falling back to the
 * platform default when the resolver produced none. Retention is default-on,
 * so that fallback is load-bearing, and holding it in one place is what keeps
 * a change to it from having to be repeated once per store.
 */
abstract class CodingAgentAppendStore<TRecord> implements AppendStore<TRecord> {
  protected abstract appendRecords(
    records: TRecord[],
    retentionDays: number,
  ): Promise<void>;

  async append(record: TRecord, context: ProjectionStoreContext): Promise<void> {
    await this.bulkAppend([record], context);
  }

  async bulkAppend(
    records: TRecord[],
    context: ProjectionStoreContext | BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.appendRecords(
      records,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}

export class CodingAgentTraceSessionAppendStore extends CodingAgentAppendStore<CodingAgentTraceSessionRecord> {
  constructor(private readonly persistence: CodingAgentProjectionPersistence) {
    super();
  }

  protected appendRecords(
    records: CodingAgentTraceSessionRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendTraceSessions(records, retentionDays);
  }
}

export class CodingAgentSessionEventsAppendStore extends CodingAgentAppendStore<CodingAgentSessionEventRecord> {
  constructor(private readonly persistence: CodingAgentProjectionPersistence) {
    super();
  }

  protected appendRecords(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendSessionEvents(records, retentionDays);
  }
}

export class SessionMetricSeriesAppendStore extends CodingAgentAppendStore<SessionMetricSeriesRecord> {
  constructor(private readonly persistence: CodingAgentProjectionPersistence) {
    super();
  }

  protected appendRecords(
    records: SessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendMetricSeries(records, retentionDays);
  }
}
