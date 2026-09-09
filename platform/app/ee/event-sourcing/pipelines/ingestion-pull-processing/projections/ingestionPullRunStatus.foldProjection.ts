import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import {
  INGESTION_PULL_LISTING_OUTCOME,
  INGESTION_PULL_PROJECTION_VERSIONS,
  INGESTION_PULL_RUN_OUTCOME,
} from "../schemas/constants";
import {
  type IngestionPullAgentsListedEvent,
  IngestionPullAgentsListedEventSchema,
  type IngestionPullAgentsListingRefusedEvent,
  IngestionPullAgentsListingRefusedEventSchema,
  type IngestionPullConfiguredEvent,
  IngestionPullConfiguredEventSchema,
  type IngestionPullDisabledEvent,
  IngestionPullDisabledEventSchema,
  type IngestionPullPeopleListedEvent,
  IngestionPullPeopleListedEventSchema,
  type IngestionPullPeopleListingRefusedEvent,
  IngestionPullPeopleListingRefusedEventSchema,
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
  /**
   * What the last agents listing did, in its own set of fields.
   *
   * A listing is a different scope on the same connection as the pull above: a
   * credential that cannot enumerate a directory still pulls cost perfectly.
   * So none of these may be read as the source failing to pull, and the fields
   * a health reader uses are deliberately disjoint from these.
   *
   * `LastAgentsListingCount` is set only when the outcome is listed and stays
   * null on a refusal, because zero means the provider returned an empty list,
   * which is a real answer. `LastAgentsListingReason` is set only on a refusal
   * and stays a plain string, never an enum, because the log outlives the
   * vocabulary. `LastAgentsListingStatus` is null when the refusal was
   * generated on our own side and never reached the provider.
   */
  LastAgentsListingAt: number | null;
  LastAgentsListingOutcome: string | null;
  LastAgentsListingCount: number | null;
  LastAgentsListingReason: string | null;
  LastAgentsListingStatus: number | null;
  /**
   * The same for people, in its own set rather than sharing the agents set
   * with a kind discriminator. A source can be refused for people and fine for
   * agents; one shared set holds only the most recent listing of either kind,
   * so a people sync would erase an agents refusal and the agents page would go
   * back to not knowing after briefly knowing.
   *
   * `LastPeopleDirectoryCount` is everyone the provider's directory named.
   * `LastPeopleWithheldCount` is how many of those this deployment does not
   * hold, because erasure suppression removed them: a SUBSET of the directory
   * count, never an addition to it. Adding the two counts the same people
   * twice. Subtracting is the valid arithmetic, and the surviving total is that
   * subtraction rather than a third field that could disagree with these two.
   *
   * The withheld count is safe to show as a CURRENT figure and never as a
   * series: it moving from zero to one at a known moment says an erasure
   * happened then, which on a small tenant identifies the person as surely as a
   * name would. So no trend line, no history drawer, no per-run export, and
   * never beside a per-person list.
   */
  LastPeopleListingAt: number | null;
  LastPeopleListingOutcome: string | null;
  LastPeopleDirectoryCount: number | null;
  LastPeopleWithheldCount: number | null;
  LastPeopleListingReason: string | null;
  LastPeopleListingStatus: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const ingestionPullEvents = [
  IngestionPullConfiguredEventSchema,
  IngestionPullDisabledEventSchema,
  IngestionPullRunCompletedEventSchema,
  IngestionPullRunFailedEventSchema,
  IngestionPullAgentsListedEventSchema,
  IngestionPullAgentsListingRefusedEventSchema,
  IngestionPullPeopleListedEventSchema,
  IngestionPullPeopleListingRefusedEventSchema,
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
      // Null on every listing column, and null is the reading itself rather
      // than a placeholder for one: no listing of that kind has been recorded
      // for this source. A zero would say the provider named nobody, which is
      // a different and much stronger claim than never having asked.
      LastAgentsListingAt: null,
      LastAgentsListingOutcome: null,
      LastAgentsListingCount: null,
      LastAgentsListingReason: null,
      LastAgentsListingStatus: null,
      LastPeopleListingAt: null,
      LastPeopleListingOutcome: null,
      LastPeopleDirectoryCount: null,
      LastPeopleWithheldCount: null,
      LastPeopleListingReason: null,
      LastPeopleListingStatus: null,
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

  /**
   * The four listing handlers below all obey the same three rules, and each
   * rule is here because breaking it produces a specific wrong reading.
   *
   * They never write `LastRunScheduledFor`. That field is the fence
   * `isSuperseded` uses to reject late run outcomes, and a listing event
   * carries no `scheduledFor` at all -- there is no run behind it. Stamping
   * one would let a listing supersede a real pull and freeze `Cursor`, which
   * is the cursor-regression bug that fence exists to prevent, run backwards.
   *
   * They never touch any `LastRun*` field nor any of the seven the mirror
   * reads (`Cursor`, `ConsecutiveErrors`, `LastSuccessAt`, `LastRunOutcome`,
   * `LastRunEventCount`, `LastRunAt`, `Enabled`). A listing is a different
   * scope on the same connection: a credential that cannot enumerate a
   * directory still pulls cost perfectly, so a refused listing must never be
   * readable as the source having failed to pull.
   *
   * Each kind writes only its own columns. One shared set with a kind
   * discriminator would hold just the most recent listing of either kind, so
   * syncing people would erase an agents refusal and a broken source would
   * read as fine because a DIFFERENT sync had succeeded.
   *
   * There is no fence of their own here, and that is a DEPENDENCY on another
   * module rather than a property of this one. These four handlers assume they
   * only ever see accepted outcomes, in acceptance order, and simply overwrite
   * their columns with whatever arrives last. Nothing below would notice two
   * outcomes landing out of order: the older answer would silently win and a
   * refusal could be buried under a stale listed.
   *
   * What makes the assumption true is the process manager, in
   * `process-manager/ingestionPull.process.ts`. `listingRequestedHandler`
   * drops a second ask while `currentAgentsListing` / `currentPeopleListing`
   * is set, and `listingSettledHandler` ignores an outcome whose `requestId`
   * is not the one being tracked, so at most one listing of each kind is ever
   * in flight and its outcome is accepted once. Replay inherits the same order
   * because the log holds only what was accepted.
   *
   * A fence here was considered and rejected: the only signal available is the
   * timestamp, and an admin replaying a corrected outcome is precisely an older
   * timestamp arriving later, so a monotonic fence would drop the legitimate
   * repair to guard against a producer that does not exist. One authoritative
   * mechanism beats two weak ones.
   *
   * So the constraint travels with the producer, not with this fold: ANY new
   * producer of listing outcomes has to preserve single-in-flight and
   * accept-once, or this projection keeps the older answer without complaint.
   */
  handleIngestionPullAgentsListed(
    event: IngestionPullAgentsListedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      // When we learned the answer, not `requestedAt`, which is when we asked.
      // A reader wants the age of the knowledge, and the same choice is made
      // for `LastRunAt` above.
      LastAgentsListingAt: event.occurredAt,
      LastAgentsListingOutcome: INGESTION_PULL_LISTING_OUTCOME.LISTED,
      LastAgentsListingCount: event.data.agentCount,
      // Cleared rather than left: a reason left over from an earlier refusal
      // sitting beside a listed outcome reads as a listing that both worked
      // and was refused.
      LastAgentsListingReason: null,
      LastAgentsListingStatus: null,
    };
  }

  handleIngestionPullAgentsListingRefused(
    event: IngestionPullAgentsListingRefusedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastAgentsListingAt: event.occurredAt,
      LastAgentsListingOutcome: INGESTION_PULL_LISTING_OUTCOME.REFUSED,
      // Nulled, never carried over from the last successful listing. A refusal
      // has no count at all, and zero is already taken: it means the provider
      // answered with an empty list. Those two must stay distinguishable,
      // which is the whole point of the outcome column.
      LastAgentsListingCount: null,
      LastAgentsListingReason: event.data.reason,
      LastAgentsListingStatus: event.data.status,
    };
  }

  handleIngestionPullPeopleListed(
    event: IngestionPullPeopleListedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.occurredAt,
      LastPeopleListingOutcome: INGESTION_PULL_LISTING_OUTCOME.LISTED,
      // Both numbers, because the surviving total alone is lossy. The withheld
      // count is a SUBSET of the directory count, never an addition to it:
      // adding them counts the same people twice, subtracting gives what this
      // deployment actually holds.
      LastPeopleDirectoryCount: event.data.directoryPersonCount,
      LastPeopleWithheldCount: event.data.withheldPersonCount,
      LastPeopleListingReason: null,
      LastPeopleListingStatus: null,
    };
  }

  handleIngestionPullPeopleListingRefused(
    event: IngestionPullPeopleListingRefusedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.occurredAt,
      LastPeopleListingOutcome: INGESTION_PULL_LISTING_OUTCOME.REFUSED,
      // Both counts nulled for the reason the agents refusal gives, and the
      // withheld count doubly so: a refusal carries no directory to have
      // withheld anyone from, and a stale withheld figure shown as current
      // would be a statement about erasures that this listing never made.
      LastPeopleDirectoryCount: null,
      LastPeopleWithheldCount: null,
      LastPeopleListingReason: event.data.reason,
      LastPeopleListingStatus: event.data.status,
    };
  }
}
