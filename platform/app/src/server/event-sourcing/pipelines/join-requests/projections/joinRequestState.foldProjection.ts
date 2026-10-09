import {
  emptyJoinRequest,
  type JoinRequestAggregateState,
  reduceJoinRequest,
} from "@langwatch/identity";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  type JoinApprovedEvent,
  type JoinExpiredEvent,
  type JoinRejectedEvent,
  type JoinRequestEvent,
  type JoinRequestedEvent,
  type JoinWithdrawnEvent,
  joinApprovedEventSchema,
  joinExpiredEventSchema,
  joinRejectedEventSchema,
  joinRequestEventSchema,
  joinRequestedEventSchema,
  joinWithdrawnEventSchema,
} from "../schemas/events";

const JOIN_REQUEST_PROJECTION_VERSION = "2026-08-24";

export const JOIN_REQUEST_PROJECTION_NAME = "joinRequestState" as const;

const joinRequestEvents = [
  joinRequestedEventSchema,
  joinApprovedEventSchema,
  joinRejectedEventSchema,
  joinExpiredEventSchema,
  joinWithdrawnEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type JoinRequestFoldState = JoinRequestAggregateState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The join-request pipeline's operational projection (D12, ADR-117): one
 * Postgres `JoinRequest` row per request, applied through
 * `.withProjection()`'s direct load/apply/store cycle under the queue's
 * per-request lock.
 *
 * A pure event-truth head with whole-row replay semantics, exactly like the
 * identity pipeline's `Identifier` and the connection pipeline's
 * `SsoConnection`: every column is fold-written and rows are never deleted —
 * a terminal state is a tombstone the panel stops listing, not an absence.
 * That is also what makes the admin panel and the audit page tell the same
 * story: nothing quietly disappears when an admin answers.
 *
 * Every handler is the same move: validate the wire event and hand it to
 * `@langwatch/identity`'s reducer — live dispatch, the queue's fold and the
 * replay proof run the identical function.
 */
export class JoinRequestStateFoldProjection
  extends AbstractFoldProjection<
    JoinRequestFoldState,
    typeof joinRequestEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<JoinRequestFoldState>
  >
  implements FoldEventHandlers<typeof joinRequestEvents, JoinRequestFoldState>
{
  readonly name = JOIN_REQUEST_PROJECTION_NAME;
  readonly version = JOIN_REQUEST_PROJECTION_VERSION;
  readonly store: StateProjectionStore<JoinRequestFoldState>;

  protected readonly events = joinRequestEvents;

  constructor(deps: { store: StateProjectionStore<JoinRequestFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyJoinRequest({ joinRequestId: "" });
  }

  private fold(
    event: JoinRequestEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    const parsed = joinRequestEventSchema.parse(event);
    const next = reduceJoinRequest({
      state,
      fact: { ...parsed, occurredAt: parsed.occurredAt } as never,
    });
    return {
      ...state,
      ...next,
      // init() cannot know the request; the first applied event does.
      joinRequestId:
        next.joinRequestId === "" ? parsed.aggregateId : next.joinRequestId,
    };
  }

  handleIdentityJoinRequested(
    event: JoinRequestedEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    return this.fold(event, state);
  }

  handleIdentityJoinApproved(
    event: JoinApprovedEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    return this.fold(event, state);
  }

  handleIdentityJoinRejected(
    event: JoinRejectedEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    return this.fold(event, state);
  }

  handleIdentityJoinExpired(
    event: JoinExpiredEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    return this.fold(event, state);
  }

  handleIdentityJoinWithdrawn(
    event: JoinWithdrawnEvent,
    state: JoinRequestFoldState,
  ): JoinRequestFoldState {
    return this.fold(event, state);
  }
}
