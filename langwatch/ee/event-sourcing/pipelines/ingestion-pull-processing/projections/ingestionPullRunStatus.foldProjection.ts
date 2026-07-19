import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import {
  INGESTION_PULL_PROJECTION_VERSIONS,
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
  /**
   * Which run this row's outcome fields describe, as the run's `scheduledFor`.
   *
   * The process manager fences late outcomes by comparing `runId` against the
   * run it is currently tracking; this read model needs its own fence for the
   * same reason. Runs are scheduled in time order and `runId` is derived from
   * `scheduledFor`, so a strictly smaller `scheduledFor` means the outcome
   * belongs to a superseded run. Without this, run 1 finishing after run 2 had
   * already completed would drag `Cursor` back to run 1's window -- and the
   * repository mirrors `Cursor` into `IngestionSource.pollerCursor`, so the
   * compatibility checkpoint would regress and re-ingest that window.
   */
  LastRunScheduledFor: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const ingestionPullEvents = [
  IngestionPullConfiguredEventSchema,
  IngestionPullDisabledEventSchema,
  IngestionPullRunCompletedEventSchema,
  IngestionPullRunFailedEventSchema,
] as const;

export class IngestionPullRunStatusFoldProjection
  extends AbstractFoldProjection<
    IngestionPullRunStatusData,
    typeof ingestionPullEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<IngestionPullRunStatusData>
  >
  implements
    FoldEventHandlers<typeof ingestionPullEvents, IngestionPullRunStatusData>
{
  readonly name = "ingestionPullRunStatus";
  readonly version = INGESTION_PULL_PROJECTION_VERSIONS.RUN_STATUS;
  readonly store: StateProjectionStore<IngestionPullRunStatusData>;

  protected readonly events = ingestionPullEvents;

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
      LastRunScheduledFor: null,
    };
  }

  /**
   * Whether an outcome event comes from a run this row has already moved past.
   *
   * Equal `scheduledFor` is accepted: it is the same run reporting, which
   * replay must fold identically.
   */
  private isSuperseded(
    state: IngestionPullRunStatusData,
    scheduledFor: number,
  ): boolean {
    return (
      state.LastRunScheduledFor !== null &&
      scheduledFor < state.LastRunScheduledFor
    );
  }

  handleIngestionPullConfigured(
    event: IngestionPullConfiguredEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
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
  ): IngestionPullRunStatusData {
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
  ): IngestionPullRunStatusData {
    if (this.isSuperseded(state, event.data.scheduledFor)) return state;
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
    event: IngestionPullRunFailedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.isSuperseded(state, event.data.scheduledFor)) return state;
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
}
