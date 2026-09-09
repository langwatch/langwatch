import {
  INGESTION_PULL_PROJECTION_VERSIONS,
  INGESTION_PULL_RUN_OUTCOME,
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";
import type { z } from "zod";

export interface IngestionPullRunStatusData {
  SourceId: string;
  Enabled: boolean;
  Cron: string | null;
  Cursor: string | null;
  LastRunAt: number | null;
  LastRunOutcome: string | null;
  LastRunEventCount: number;
  LastRunError: string | null;
  LastRunErrorCode: string | null;
  ConsecutiveErrors: number;
  LastRunScheduledFor: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const ingestionPullEvents = [
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
] as const;

type ConfiguredEvent = z.infer<typeof ingestionPullConfiguredEventSchema>;
type DisabledEvent = z.infer<typeof ingestionPullDisabledEventSchema>;
type CompletedEvent = z.infer<typeof ingestionPullRunCompletedEventSchema>;
type FailedEvent = z.infer<typeof ingestionPullRunFailedEventSchema>;

export class IngestionPullRunStatusEventingProjection
  extends AbstractFoldProjection<
    IngestionPullRunStatusData,
    typeof ingestionPullEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<IngestionPullRunStatusData>
  >
  implements FoldEventHandlers<typeof ingestionPullEvents, IngestionPullRunStatusData>
{
  readonly name = "ingestionPullRunStatus";
  readonly version = INGESTION_PULL_PROJECTION_VERSIONS.RUN_STATUS;
  readonly store: StateProjectionStore<IngestionPullRunStatusData>;
  protected readonly events = ingestionPullEvents;

  private constructor(store: StateProjectionStore<IngestionPullRunStatusData>) {
    super();
    this.store = store;
  }

  static create(
    store: StateProjectionStore<IngestionPullRunStatusData>,
  ): IngestionPullRunStatusEventingProjection {
    return new IngestionPullRunStatusEventingProjection(store);
  }

  protected initState() {
    return {
      SourceId: "",
      Enabled: false,
      Cron: null,
      Cursor: null,
      LastRunAt: null,
      LastRunOutcome: null,
      LastRunEventCount: 0,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: 0,
      LastRunScheduledFor: null,
    };
  }

  handleIngestionPullConfigured(
    event: ConfiguredEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      Enabled: true,
      Cron: event.data.cron,
      Cursor: state.SourceId ? state.Cursor : event.data.cursor,
    };
  }

  handleIngestionPullDisabled(
    event: DisabledEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      Enabled: false,
      Cron: null,
    };
  }

  handleIngestionPullRunCompleted(
    event: CompletedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.superseded(state, event.data.scheduledFor)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      Cursor: event.data.nextCursor,
      LastRunAt: event.occurredAt,
      LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.COMPLETED,
      LastRunEventCount: event.data.eventCount,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: 0,
      LastRunScheduledFor: event.data.scheduledFor,
    };
  }

  handleIngestionPullRunFailed(
    event: FailedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.superseded(state, event.data.scheduledFor)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastRunAt: event.occurredAt,
      LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.FAILED,
      LastRunEventCount: 0,
      LastRunError: event.data.error,
      LastRunErrorCode: event.data.errorCode,
      ConsecutiveErrors: state.ConsecutiveErrors + 1,
      LastRunScheduledFor: event.data.scheduledFor,
    };
  }

  private superseded(state: IngestionPullRunStatusData, scheduledFor: number): boolean {
    return state.LastRunScheduledFor !== null && scheduledFor < state.LastRunScheduledFor;
  }
}
