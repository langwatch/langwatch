import {
  emptyScimSync,
  reduceScimSync,
  type ScimSyncState,
} from "@langwatch/identity-contract";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  type ScimApplyFailedEvent,
  type ScimApplyRecoveredEvent,
  type ScimApplyRetiredEvent,
  type ScimGroupMappedEvent,
  type ScimSyncEvent,
  type ScimTokenIssuedEvent,
  type ScimTokenRevokedEvent,
  type ScimUserPushedEvent,
  scimApplyFailedEventSchema,
  scimApplyRecoveredEventSchema,
  scimApplyRetiredEventSchema,
  scimGroupMappedEventSchema,
  scimSyncEventSchema,
  scimTokenIssuedEventSchema,
  scimTokenRevokedEventSchema,
  scimUserPushedEventSchema,
} from "../schemas/events";

const SCIM_SYNC_PROJECTION_VERSION = "2026-08-24";

export const SCIM_SYNC_PROJECTION_NAME = "scimSyncState" as const;

const scimSyncEvents = [
  scimTokenIssuedEventSchema,
  scimUserPushedEventSchema,
  scimGroupMappedEventSchema,
  scimApplyFailedEventSchema,
  scimApplyRecoveredEventSchema,
  scimApplyRetiredEventSchema,
  scimTokenRevokedEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type ScimSyncFoldState = ScimSyncState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The directory-sync pipeline's operational projection (D08): one Postgres
 * `ScimSyncState` row per connection's sync, applied through
 * `.withProjection()`'s direct load/apply/store cycle under the queue's
 * per-sync lock.
 *
 * A pure event-truth head with whole-row replay semantics, like the
 * connection projection beside it: every column is fold-written and rows are
 * never deleted — REVOKED is a tombstone the failure surface still shows, not
 * an absence. That matters here more than anywhere: a dead letter that
 * disappeared when a connection was torn down would be a removal nobody could
 * check afterwards.
 *
 * Every handler is the same move: validate the wire event and hand it to
 * `@langwatch/identity`'s reducer — live dispatch, the queue's fold and the
 * replay proof run the identical function.
 */
export class ScimSyncStateFoldProjection
  extends AbstractFoldProjection<
    ScimSyncFoldState,
    typeof scimSyncEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<ScimSyncFoldState>
  >
  implements FoldEventHandlers<typeof scimSyncEvents, ScimSyncFoldState>
{
  readonly name = SCIM_SYNC_PROJECTION_NAME;
  readonly version = SCIM_SYNC_PROJECTION_VERSION;
  readonly store: StateProjectionStore<ScimSyncFoldState>;

  protected readonly events = scimSyncEvents;

  constructor(deps: { store: StateProjectionStore<ScimSyncFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyScimSync({ scimSyncId: "" });
  }

  private fold(
    event: ScimSyncEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    const parsed = scimSyncEventSchema.parse(event);
    const next = reduceScimSync({
      state,
      fact: { ...parsed, occurredAt: parsed.occurredAt } as never,
    });
    return {
      ...state,
      ...next,
      // init() cannot know the sync; the first applied event does.
      scimSyncId: next.scimSyncId === "" ? parsed.aggregateId : next.scimSyncId,
    };
  }

  handleIdentityScimTokenIssued(
    event: ScimTokenIssuedEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimUserPushed(
    event: ScimUserPushedEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimGroupMapped(
    event: ScimGroupMappedEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimApplyFailed(
    event: ScimApplyFailedEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimApplyRecovered(
    event: ScimApplyRecoveredEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimApplyRetired(
    event: ScimApplyRetiredEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }

  handleIdentityScimTokenRevoked(
    event: ScimTokenRevokedEvent,
    state: ScimSyncFoldState,
  ): ScimSyncFoldState {
    return this.fold(event, state);
  }
}
