import {
  INGESTION_PULL_LISTING_OUTCOME,
  INGESTION_PULL_PROJECTION_VERSIONS,
  INGESTION_PULL_RUN_OUTCOME,
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
  ingestionPullAgentsListedEventSchema,
  ingestionPullAgentsListingRefusedEventSchema,
  ingestionPullPeopleListedEventSchema,
  ingestionPullPeopleListingRefusedEventSchema,
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
  LastSuccessAt: number | null;
  LastReadThroughAt: number | null;
  LastRunCompleteness: "complete" | "truncated" | null;
  LastAgentsListingAt: number | null;
  LastAgentsListingOutcome: string | null;
  LastAgentsListingCount: number | null;
  LastAgentsListingReason: string | null;
  LastAgentsListingStatus: number | null;
  LastPeopleListingAt: number | null;
  LastPeopleListingOutcome: string | null;
  LastPeopleDirectoryCount: number | null;
  /** Nothing reads it: a withheld count that moves dates an erasure (main's commands.ts). */
  LastPeopleWithheldCount: number | null;
  LastPeopleListingReason: string | null;
  LastPeopleListingStatus: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const ingestionPullEvents = [
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
  ingestionPullAgentsListedEventSchema,
  ingestionPullAgentsListingRefusedEventSchema,
  ingestionPullPeopleListedEventSchema,
  ingestionPullPeopleListingRefusedEventSchema,
] as const;

type ConfiguredEvent = z.infer<typeof ingestionPullConfiguredEventSchema>;
type DisabledEvent = z.infer<typeof ingestionPullDisabledEventSchema>;
type CompletedEvent = z.infer<typeof ingestionPullRunCompletedEventSchema>;
type FailedEvent = z.infer<typeof ingestionPullRunFailedEventSchema>;
type AgentsListedEvent = z.infer<typeof ingestionPullAgentsListedEventSchema>;
type AgentsListingRefusedEvent = z.infer<typeof ingestionPullAgentsListingRefusedEventSchema>;
type PeopleListedEvent = z.infer<typeof ingestionPullPeopleListedEventSchema>;
type PeopleListingRefusedEvent = z.infer<typeof ingestionPullPeopleListingRefusedEventSchema>;

/** Absent fields leave the stored value: an older completion is no evidence either way. */
function readThroughOf(event: CompletedEvent): {
  LastReadThroughAt?: number;
  LastRunCompleteness?: "complete" | "truncated";
} {
  return {
    ...(typeof event.data.readThroughAt === "number"
      ? { LastReadThroughAt: event.data.readThroughAt }
      : {}),
    ...(event.data.completeness !== undefined
      ? { LastRunCompleteness: event.data.completeness }
      : {}),
  };
}

/** An unread page counts as a failure; skipped rows hold the count; a clean run resets it. */
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

  protected initState(): Omit<
    IngestionPullRunStatusData,
    "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
  > {
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
    const hasUnreadPage = event.data.unreadPage === true;
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
      LastSuccessAt: hasPartialSuccess ? state.LastSuccessAt : event.occurredAt,
      ...readThroughOf(event),
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

  handleIngestionPullAgentsListed(
    event: AgentsListedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.listingSuperseded(state.LastAgentsListingAt, event.data.requestedAt)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastAgentsListingAt: event.data.requestedAt,
      LastAgentsListingOutcome: INGESTION_PULL_LISTING_OUTCOME.LISTED,
      LastAgentsListingCount: event.data.agentCount,
      LastAgentsListingReason: null,
      LastAgentsListingStatus: null,
    };
  }

  handleIngestionPullAgentsListingRefused(
    event: AgentsListingRefusedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.listingSuperseded(state.LastAgentsListingAt, event.data.requestedAt)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastAgentsListingAt: event.data.requestedAt,
      LastAgentsListingOutcome: INGESTION_PULL_LISTING_OUTCOME.REFUSED,
      LastAgentsListingCount: null,
      LastAgentsListingReason: event.data.reason,
      LastAgentsListingStatus: event.data.status,
    };
  }

  handleIngestionPullPeopleListed(
    event: PeopleListedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.listingSuperseded(state.LastPeopleListingAt, event.data.requestedAt)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.data.requestedAt,
      LastPeopleListingOutcome: INGESTION_PULL_LISTING_OUTCOME.LISTED,
      LastPeopleDirectoryCount: event.data.directoryPersonCount,
      LastPeopleWithheldCount: event.data.withheldPersonCount,
      LastPeopleListingReason: null,
      LastPeopleListingStatus: null,
    };
  }

  handleIngestionPullPeopleListingRefused(
    event: PeopleListingRefusedEvent,
    state: IngestionPullRunStatusData,
  ): IngestionPullRunStatusData {
    if (this.listingSuperseded(state.LastPeopleListingAt, event.data.requestedAt)) return state;
    return {
      ...state,
      SourceId: event.data.sourceId,
      LastPeopleListingAt: event.data.requestedAt,
      LastPeopleListingOutcome: INGESTION_PULL_LISTING_OUTCOME.REFUSED,
      LastPeopleDirectoryCount: null,
      LastPeopleWithheldCount: null,
      LastPeopleListingReason: event.data.reason,
      LastPeopleListingStatus: event.data.status,
    };
  }

  /** A listing asked earlier than the recorded one lost the race and must not overwrite it. */
  private listingSuperseded(recorded: number | null, requestedAt: number): boolean {
    return recorded !== null && requestedAt < recorded;
  }

  private superseded(state: IngestionPullRunStatusData, scheduledFor: number): boolean {
    return state.LastRunScheduledFor !== null && scheduledFor < state.LastRunScheduledFor;
  }
}
