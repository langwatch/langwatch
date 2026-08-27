import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import type { CodingAgentSessionEventRecord } from "../projections/coding-agent-session-events.projection";
import type { CodingAgentTraceSessionRecord } from "../projections/coding-agent-trace-sessions.projection";
import type { SessionMetricSeriesRecord } from "../projections/session-metric-series.projection";

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
  protected constructor(private readonly defaultRetentionDays: number) {}

  protected abstract appendRecords(records: TRecord[], retentionDays: number): Promise<void>;

  async append(record: TRecord, context: ProjectionStoreContext): Promise<void> {
    await this.bulkAppend([record], context);
  }

  async bulkAppend(
    records: TRecord[],
    context: ProjectionStoreContext | BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.appendRecords(records, context.retentionPolicy?.traces ?? this.defaultRetentionDays);
  }
}

export class EventingCodingAgentTraceSessionAppendAdapter extends CodingAgentAppendStore<CodingAgentTraceSessionRecord> {
  private constructor(
    private readonly persistence: CodingAgentProjectionPersistence,
    defaultRetentionDays: number,
  ) {
    super(defaultRetentionDays);
  }

  static create(input: {
    persistence: CodingAgentProjectionPersistence;
    defaultRetentionDays: number;
  }): EventingCodingAgentTraceSessionAppendAdapter {
    return new EventingCodingAgentTraceSessionAppendAdapter(
      input.persistence,
      input.defaultRetentionDays,
    );
  }

  protected appendRecords(
    records: CodingAgentTraceSessionRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendTraceSessions(records, retentionDays);
  }
}

export class EventingCodingAgentSessionEventsAppendAdapter extends CodingAgentAppendStore<CodingAgentSessionEventRecord> {
  private constructor(
    private readonly persistence: CodingAgentProjectionPersistence,
    defaultRetentionDays: number,
  ) {
    super(defaultRetentionDays);
  }

  static create(input: {
    persistence: CodingAgentProjectionPersistence;
    defaultRetentionDays: number;
  }): EventingCodingAgentSessionEventsAppendAdapter {
    return new EventingCodingAgentSessionEventsAppendAdapter(
      input.persistence,
      input.defaultRetentionDays,
    );
  }

  protected appendRecords(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendSessionEvents(records, retentionDays);
  }
}

export class EventingSessionMetricSeriesAppendAdapter extends CodingAgentAppendStore<SessionMetricSeriesRecord> {
  private constructor(
    private readonly persistence: CodingAgentProjectionPersistence,
    defaultRetentionDays: number,
  ) {
    super(defaultRetentionDays);
  }

  static create(input: {
    persistence: CodingAgentProjectionPersistence;
    defaultRetentionDays: number;
  }): EventingSessionMetricSeriesAppendAdapter {
    return new EventingSessionMetricSeriesAppendAdapter(
      input.persistence,
      input.defaultRetentionDays,
    );
  }

  protected appendRecords(
    records: SessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.persistence.appendMetricSeries(records, retentionDays);
  }
}
