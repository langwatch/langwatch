import {
  emptyIdentityHeads,
  type IdentityHeads,
  reduceIdentity,
} from "@langwatch/identity";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  type IdentifierAttachedEvent,
  type IdentifierDeadEndedEvent,
  type IdentifierDetachedEvent,
  type IdentifierVerifiedEvent,
  type IdentityEvent,
  identifierAttachedEventSchema,
  identifierDeadEndedEventSchema,
  identifierDetachedEventSchema,
  identifierVerifiedEventSchema,
  identityEventSchema,
  type LinkConfirmedEvent,
  type LinkProposedEvent,
  type LinkRejectedEvent,
  linkConfirmedEventSchema,
  linkProposedEventSchema,
  linkRejectedEventSchema,
  type PrimaryChangedEvent,
  primaryChangedEventSchema,
  type UserErasedEvent,
  userErasedEventSchema,
} from "../schemas/events";

const IDENTITY_PROJECTION_VERSION = "2026-08-20";

const identityEvents = [
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
  linkProposedEventSchema,
  linkConfirmedEventSchema,
  linkRejectedEventSchema,
] as const;

/** The reducer's heads plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type IdentityFoldState = IdentityHeads & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The identity pipeline's operational projection (ADR-101 §3): one Postgres
 * state per user, applied through `.withProjection()`'s direct
 * load/apply/store cycle under the queue's per-user lock. The store writes
 * `Identifier` rows plus the cursor — a pure event-truth head, whole-row
 * replay semantics, ADR-022/015 unamended.
 *
 * Every handler is the same move: validate the wire event and hand it to
 * `@langwatch/identity`'s reducer — live dispatch, the queue's fold and the
 * replay proof run the identical function.
 */
export class IdentityStateFoldProjection
  extends AbstractFoldProjection<
    IdentityFoldState,
    typeof identityEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<IdentityFoldState>
  >
  implements FoldEventHandlers<typeof identityEvents, IdentityFoldState>
{
  readonly name = "identityState";
  readonly version = IDENTITY_PROJECTION_VERSION;
  readonly store: StateProjectionStore<IdentityFoldState>;

  protected readonly events = identityEvents;

  constructor(deps: { store: StateProjectionStore<IdentityFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyIdentityHeads({ userId: "" });
  }

  private fold(
    event: IdentityEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    const parsed = identityEventSchema.parse(event);
    const next = reduceIdentity({ heads: state, fact: parsed });
    return {
      ...state,
      ...next,
      // init() cannot know the user; the first applied event does.
      userId: next.userId === "" ? parsed.aggregateId : next.userId,
    };
  }

  handleIdentityIdentifierAttached(
    event: IdentifierAttachedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityIdentifierVerified(
    event: IdentifierVerifiedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityIdentifierDeadEnded(
    event: IdentifierDeadEndedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityPrimaryChanged(
    event: PrimaryChangedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityIdentifierDetached(
    event: IdentifierDetachedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityUserErased(
    event: UserErasedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  /**
   * Folded like every other fact, and the reducer leaves the heads alone: a
   * proposal states that no identifier was attached. It runs through the same
   * path anyway so the projection's cursor advances past it — a fact the fold
   * skipped would leave the read-your-writes wait watching for a cursor that
   * never moves.
   */
  handleIdentityLinkProposed(
    event: LinkProposedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  /**
   * A decision on a proposal, folded for the same reason the proposal is:
   * it moves no head, and it still has to move the cursor. Confirming is
   * followed by the ordinary attach ceremony, which is what actually gives
   * the person a head — so a fold that attached one here would be doing the
   * ceremony's job with none of its guards.
   */
  handleIdentityLinkConfirmed(
    event: LinkConfirmedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  handleIdentityLinkRejected(
    event: LinkRejectedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }
}
