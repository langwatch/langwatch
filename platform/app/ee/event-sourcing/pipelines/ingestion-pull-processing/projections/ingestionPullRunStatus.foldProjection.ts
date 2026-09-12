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
   *
   * `LastAgentsListingAt` is the instant the ASK was accepted -- the outcome
   * event's `requestedAt` -- and not the instant its answer was recorded. It
   * is the fence the four listing handlers order outcomes by, and the ask
   * instant is the only one that orders them correctly: a superseded listing
   * records LAST, so its answer instant is the newer of the two. Read it as
   * "the listing this row describes was asked for then", never as "we learned
   * this then"; the two differ by however long the provider took.
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
   * This row is a sink the withheld count is allowed to sit in, because it is
   * inside our boundary, under our retention, and readable only by those we
   * granted this tenant's data to. The event log holds the same count per run
   * for the same reason, deliberately.
   *
   * It must not be forwarded to a sink outside that boundary — telemetry
   * export above all, whose readers are every engineer with a dashboard login
   * rather than the readers of this tenant. The test is who can read the sink,
   * not whether the sink holds a series; the field doc on `withheldPersonCount`
   * in `../schemas/events` is the full statement of it.
   *
   * What the product may draw with it is limited by the same disclosure: a
   * CURRENT figure only, because this number moving from zero to one at a known
   * moment says an erasure happened then, which on a small tenant identifies
   * the person as surely as a name would. No trend line, no history drawer, and
   * never beside a per-person list.
   *
   * `LastPeopleListingAt` carries the ask instant and fences late outcomes,
   * exactly as `LastAgentsListingAt` above does. The same reading applies.
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
 * Both fields are optional on the event, and that is the correct reading
 * rather than a gap: the log is append-only, every completion already on it
 * was written before runs said how far they read, and the answer for those is
 * "we do not know" rather than any particular value.
 *
 * Absent means the two stay at whatever the row already held, so a producer
 * that has not been taught to report yet cannot erase what an earlier one did.
 *
 * An explicit `readThroughAt: null` is held the same way, and that is a
 * decision rather than an oversight. `LastReadThroughAt` is how far this
 * SOURCE has been read, not how far its most recent run got, and a run that
 * reached nowhere read nothing back out of the source. Two ordinary runs
 * report null: a paused or archived source, which completes without asking the
 * provider anything, and a truncated run that emitted no readable event.
 * Clearing on either would turn a known read-through point into "unknown" —
 * which is exactly the state the field's own doc reserves for a source nobody
 * has read yet, and which would drop the truncation notice off the stuck
 * sources it exists to mark.
 */
function readThroughOf(event: IngestionPullRunCompletedEvent): {
  LastReadThroughAt?: number;
  LastRunCompleteness?: "complete" | "truncated";
} {
  const reported = event.data;
  return {
    ...(typeof reported.readThroughAt === "number"
      ? { LastReadThroughAt: reported.readThroughAt }
      : {}),
    ...(reported.completeness !== undefined
      ? { LastRunCompleteness: reported.completeness }
      : {}),
  };
}

/**
 * The failure count a completion leaves behind, in its three shapes.
 *
 * A clean run clears it: reaching the provider and being answered is the proof
 * the source works, including when the answer is "no usage".
 *
 * A run that delivered something but also stepped over input it could not read
 * neither clears it nor adds to it, and stamps no success. Counting that as a
 * success wrote a fresh one over exactly the signals meant to be loud; counting
 * it as a failure would turn a source working around one bad row red.
 *
 * A run that could not read a PAGE adds to it, even though it completed. That
 * is the difference between working around input and not reading the window at
 * all. Holding the count still here let a source refused part-way through every
 * run sit at zero failures forever: it never reached the threshold that shows
 * pulls as failing, showed the amber partly-collected line instead, and
 * collected a fraction of its spend every hour while reading as healthy. The
 * progress it banked is kept either way — the cursor advances above, and it is
 * only the source's health this answers.
 */
function consecutiveErrorsAfterCompletion({
  previous,
  hasPartialSuccess,
  hasUnreadPage,
}: {
  previous: number;
  hasPartialSuccess: boolean;
  hasUnreadPage: boolean;
}): number {
  if (hasUnreadPage) return previous + 1;
  return hasPartialSuccess ? previous : 0;
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

  /**
   * Whether a listing outcome belongs to an ask this row has already moved
   * past.
   *
   * The stored value is the `requestedAt` of the ask the row's listing columns
   * describe, so this compares ASK against ASK. Comparing against the outcome
   * instant instead would read backwards: a late outcome is recorded after the
   * one that overtook it, so it carries the newer `occurredAt` of the two.
   *
   * Equal is accepted, for the reason `isSuperseded` accepts an equal
   * `scheduledFor`: it is the same ask reporting, and replay must fold it
   * identically.
   *
   * Null means no listing of that kind has been recorded, so nothing can have
   * superseded this one.
   */
  private isListingSuperseded({
    recorded,
    requestedAt,
  }: {
    recorded: number | null;
    requestedAt: number;
  }): boolean {
    return recorded !== null && requestedAt < recorded;
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
    // A page this run could not read AT ALL, as opposed to rows it read and
    // stepped over. The adapter banks the pages it already had rather than
    // throwing them away, so this failure arrives on a COMPLETION -- and it is
    // still the failure it would have been had it arrived on the first page.
    const hasUnreadPage = event.data.unreadPage === true;
    // Absent on every completion written before runs reported an error count,
    // and reading that as a clean run is correct: those producers failed the
    // whole run rather than returning partial progress.
    const hasPartialSuccess = (event.data.errorCount ?? 0) > 0 || hasUnreadPage;
    return {
      ...state,
      SourceId: event.data.sourceId,
      Cursor: event.data.nextCursor,
      LastRunAt: event.occurredAt,
      LastRunOutcome: INGESTION_PULL_RUN_OUTCOME.COMPLETED,
      LastRunEventCount: event.data.eventCount,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: consecutiveErrorsAfterCompletion({
        previous: state.ConsecutiveErrors,
        hasPartialSuccess,
        hasUnreadPage,
      }),
      LastRunScheduledFor: event.data.scheduledFor,
      // Stamped on every clean completion, including one that found nothing
      // new: reaching the provider and being told "no usage" is a working
      // puller.
      LastSuccessAt: hasPartialSuccess ? state.LastSuccessAt : event.occurredAt,
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
   * These four handlers FENCE on the ask each outcome belongs to. An outcome
   * whose `requestedAt` is older than the one this row already reflects is
   * dropped, because it describes a listing something has since superseded.
   *
   * The fence is here because the producer's guard does not cover this case.
   * `listingRequestedHandler` refuses to DISPATCH a second listing while one is
   * in flight, and `listingSettledHandler` refuses to free a slot a different
   * request owns -- both govern the process manager's slot, not what reaches the
   * log. The effect in `process-manager/ingestionPullEffects.ts` records its
   * outcome unconditionally, so a listing that was dispatched always commits
   * one, whatever happened while it was away. Two ordinary things free the slot
   * out from under a listing that is still running: the source being disabled,
   * which clears both slots outright, and the ask outliving
   * `INGESTION_PULL_STALE_LISTING_MS`. Either one lets a second ask be accepted,
   * dispatched and finished, and then be overwritten by the first one's late
   * answer -- a refusal buried under a stale listed, or a page telling a
   * customer their directory synced fine while the credential that reads it is
   * dead. There is no error and no log line; the wrong number simply sits there
   * looking like a number.
   *
   * `requestedAt` is the key and `occurredAt` is not, which is the whole reason
   * this fence works. The stale outcome is the one recorded LAST, so its
   * `occurredAt` is the NEWER of the two and a monotonic fence on it would keep
   * precisely the wrong answer. `requestedAt` is the instant the ask was
   * accepted, carried from the request event through the intent to the outcome,
   * so it orders the two ASKS rather than their answers.
   *
   * Equal `requestedAt` is accepted, matching `isSuperseded` above: it is the
   * same ask reporting, which replay must fold identically, and one ask can
   * legitimately record twice -- a `listed` from one attempt, then a
   * `listing_failed` refusal from a redelivery that ran out of attempts.
   *
   * The repair path is to ASK AGAIN, never to replay a corrected outcome. A new
   * ask carries a newer `requestedAt` and wins; a hand-written replay of an old
   * outcome carries an old one and is dropped, which is the point of the fence
   * rather than a limitation of it.
   *
   * A producer other than the process manager still owes one guarantee this fold
   * cannot check: ACCEPT ONCE PER ASK. The fence orders distinct asks. It cannot
   * tell two disagreeing answers to the SAME ask apart, and will fold both.
   */
  handleIngestionPullAgentsListed(
    event: IngestionPullAgentsListedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (
      this.isListingSuperseded({
        recorded: state.LastAgentsListingAt,
        requestedAt: event.data.requestedAt,
      })
    ) {
      return state;
    }
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastAgentsListingAt: event.data.requestedAt,
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
    if (
      this.isListingSuperseded({
        recorded: state.LastAgentsListingAt,
        requestedAt: event.data.requestedAt,
      })
    ) {
      return state;
    }
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastAgentsListingAt: event.data.requestedAt,
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
    if (
      this.isListingSuperseded({
        recorded: state.LastPeopleListingAt,
        requestedAt: event.data.requestedAt,
      })
    ) {
      return state;
    }
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.data.requestedAt,
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
    if (
      this.isListingSuperseded({
        recorded: state.LastPeopleListingAt,
        requestedAt: event.data.requestedAt,
      })
    ) {
      return state;
    }
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.data.requestedAt,
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
