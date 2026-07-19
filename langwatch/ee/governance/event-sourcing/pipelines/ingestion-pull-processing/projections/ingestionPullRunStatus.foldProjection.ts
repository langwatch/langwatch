import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import {
  INGESTION_PULL_PROJECTION_VERSION,
  INGESTION_PULL_RUN_OUTCOME,
} from "../schemas/constants";
import {
  type IngestionPullConfiguredEvent,
  IngestionPullConfiguredEventSchema,
  type IngestionPullDisabledEvent,
  IngestionPullDisabledEventSchema,
  type IngestionPullRunCompletedEvent,
  IngestionPullRunCompletedEventSchema,
  type IngestionPullRunFailedEvent,
  IngestionPullRunFailedEventSchema,
} from "../schemas/events";

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
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const events = [
  IngestionPullConfiguredEventSchema,
  IngestionPullDisabledEventSchema,
  IngestionPullRunCompletedEventSchema,
  IngestionPullRunFailedEventSchema,
] as const;

export class IngestionPullRunStatusFoldProjection
  extends AbstractFoldProjection<
    IngestionPullRunStatusData,
    typeof events,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<IngestionPullRunStatusData>
  >
  implements FoldEventHandlers<typeof events, IngestionPullRunStatusData>
{
  readonly name = "ingestionPullRunStatus";
  readonly version = INGESTION_PULL_PROJECTION_VERSION;
  readonly store: StateProjectionStore<IngestionPullRunStatusData>;
  protected readonly events = events;

  constructor(deps: {
    store: StateProjectionStore<IngestionPullRunStatusData>;
  }) {
    super();
    this.store = deps.store;
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
    };
  }

  handleIngestionPullConfigured(
    event: IngestionPullConfiguredEvent,
    state: IngestionPullRunStatusData,
  ) {
    return {
      ...state,
      SourceId: event.data.sourceId,
      Enabled: true,
      Cron: event.data.cron,
      Cursor: event.data.cursor,
    };
  }

  handleIngestionPullDisabled(
    event: IngestionPullDisabledEvent,
    state: IngestionPullRunStatusData,
  ) {
    return {
      ...state,
      SourceId: event.data.sourceId,
      Enabled: false,
      Cron: null,
    };
  }

  handleIngestionPullRunCompleted(
    event: IngestionPullRunCompletedEvent,
    state: IngestionPullRunStatusData,
  ) {
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
    };
  }

  handleIngestionPullRunFailed(
    event: IngestionPullRunFailedEvent,
    state: IngestionPullRunStatusData,
  ) {
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastRunAt: event.occurredAt,
      LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.FAILED,
      LastRunEventCount: 0,
      LastRunError: event.data.error,
      LastRunErrorCode: event.data.errorCode,
      ConsecutiveErrors: state.ConsecutiveErrors + 1,
    };
  }
}
