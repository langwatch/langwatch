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
   * When a run last reached the provider and came back without an error.
   *
   * Distinct from `LastRunAt`, which moves on failures too, and from
   * `IngestionSource.lastEventAt`, which moves only when data arrives. Health
   * needs the third question -- when did the pull itself last work -- and
   * neither of the other two answers it, so a source whose provider had gone
   * dark looked identical to one that was merely quiet (ADR-128).
   */
  LastSuccessAt: number | null;
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
  /**
   * The instant the last run actually READ THROUGH TO -- the newest bucket it
   * got from the provider, not the moment it stopped.
   *
   * A run that hit its page limit or ran out of time ends without an error and
   * with a perfectly recent finish time, while the provider still holds pages
   * behind it. Coverage asked `LastSuccessAt` whether a day had been read, and
   * `LastSuccessAt` answers a different question: whether the run FINISHED,
   * which a half-read run also did. Everything downstream that claims a day
   * was collected reasons from this instead.
   *
   * Null until a run reports one, and on every row written before the column
   * existed. Null reads as unknown, never as "read through to now".
   */
  LastReadThroughAt: number | null;
  /**
   * Whether the last run reached the end of what the provider had, or stopped
   * short of it.
   *
   * One fact rather than two, deliberately: a page limit and a time limit are
   * different reasons for the same customer-visible thing, and splitting them
   * would give every reader two states to reason about where there is one.
   *
   * Null on every row written before the column existed, which reads as
   * unknown rather than as complete -- claiming a run we have no record of was
   * complete is the one answer that could quietly bless a half-read source.
   */
  LastRunCompleteness: "complete" | "truncated" | null;
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

/**
 * What the run reported about how far it read, off a completion event.
 *
 * Read through a widening rather than off the event type because the two
 * fields are not on `IngestionPullRunCompletedEventSchema` yet -- that schema
 * is being changed in another branch and is held. The widening is not a
 * workaround for a missing field so much as the correct reading either way:
 * the log is append-only, every completion already on it was written before
 * runs said how far they read, and the answer for those is "we do not know"
 * rather than any particular value.
 *
 * Absent means the two stay at whatever the row already held, so a producer
 * that has not been taught to report yet cannot erase what an earlier one did.
 */
function readThroughOf(event: IngestionPullRunCompletedEvent): {
  LastReadThroughAt?: number;
  LastRunCompleteness?: "complete" | "truncated";
} {
  const reported = event.data as typeof event.data & {
    readThroughAt?: number;
    completeness?: "complete" | "truncated";
  };
  return {
    ...(typeof reported.readThroughAt === "number"
      ? { LastReadThroughAt: reported.readThroughAt }
      : {}),
    ...(reported.completeness !== undefined
      ? { LastRunCompleteness: reported.completeness }
      : {}),
  };
}

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
      LastSuccessAt: null,
      LastReadThroughAt: null,
      LastRunCompleteness: null,
    };
  }

  /**
   * Whether an outcome event comes from a run this row has already moved past.
   *
   * Equal `scheduledFor` is accepted: it is the same run reporting, which
   * replay must fold identically.
   */
  private isSuperseded({
    state,
    scheduledFor,
  }: {
    state: IngestionPullRunStatusData;
    scheduledFor: number;
  }): boolean {
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
      // Only the FIRST configure seeds the cursor. A reconfigure carries a
      // cursor snapshotted from IngestionSource.pollerCursor when the edit was
      // made, so adopting it would drag a live cursor backwards whenever
      // someone renames a source or edits its schedule while a pull is in
      // flight -- re-ingesting that window. The process manager fences this
      // exact case (`previousState.sourceId ? previousState.cursor :
      // view.cursor`); the read model has to agree, because its Cursor is
      // mirrored back into pollerCursor.
      Cursor: state.SourceId ? state.Cursor : event.data.cursor,
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
    if (this.isSuperseded({ state, scheduledFor: event.data.scheduledFor }))
      return state;
    // Absent on every completion written before runs reported an error count,
    // and reading that as a clean run is correct: those producers failed the
    // whole run rather than returning partial progress.
    const partlySucceeded = (event.data.errorCount ?? 0) > 0;
    return {
      ...state,
      SourceId: event.data.sourceId,
      Cursor: event.data.nextCursor,
      LastRunAt: event.occurredAt,
      LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.COMPLETED,
      LastRunEventCount: event.data.eventCount,
      LastRunError: null,
      LastRunErrorCode: null,
      // A run that delivered something but also stepped over rows it could not
      // read, or refused a next-page link, is not the clean run that proves the
      // source works -- so it neither clears the failure count nor adds to it,
      // and it stamps no success. Counting it as one wrote a fresh success over
      // exactly the signals that were meant to be loud, and a source could
      // launder itself healthy forever while never reading a whole page.
      ConsecutiveErrors: partlySucceeded ? state.ConsecutiveErrors : 0,
      LastRunScheduledFor: event.data.scheduledFor,
      // Stamped on every clean completion, including one that found nothing
      // new: reaching the provider and being told "no usage" is a working
      // puller.
      LastSuccessAt: partlySucceeded ? state.LastSuccessAt : event.occurredAt,
      ...readThroughOf(event),
    };
  }

  handleIngestionPullRunFailed(
    event: IngestionPullRunFailedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.isSuperseded({ state, scheduledFor: event.data.scheduledFor }))
      return state;
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
