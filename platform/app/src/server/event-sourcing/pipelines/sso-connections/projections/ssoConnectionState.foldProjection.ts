import {
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionState,
} from "@langwatch/identity";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type FoldsWholeUnion,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  type ConnectionActivatedEvent,
  type ConnectionArrivalPolicySetEvent,
  type ConnectionDiscardedEvent,
  type ConnectionRegisteredEvent,
  type ConnectionResumedEvent,
  type ConnectionSuspendedEvent,
  type ConnectionTornDownEvent,
  connectionActivatedEventSchema,
  connectionArrivalPolicySetEventSchema,
  connectionDiscardedEventSchema,
  connectionRegisteredEventSchema,
  connectionResumedEventSchema,
  connectionSuspendedEventSchema,
  connectionTornDownEventSchema,
  type DomainAttestedEvent,
  type DomainClaimApprovedEvent,
  type DomainClaimedEvent,
  type DomainClaimRejectedEvent,
  type DomainProofLapsedEvent,
  type DomainProofRecoveredEvent,
  type DomainProofWaveredEvent,
  type DomainVerifiedEvent,
  type DomainWithdrawnEvent,
  domainAttestedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimedEventSchema,
  domainClaimRejectedEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
  domainProofWaveredEventSchema,
  domainVerifiedEventSchema,
  domainWithdrawnEventSchema,
  type SsoConnectionEvent,
  ssoConnectionEventSchema,
  type TeardownRequestedEvent,
  teardownRequestedEventSchema,
  type VerificationRequestedEvent,
  verificationRequestedEventSchema,
} from "../schemas/events";

const SSO_CONNECTION_PROJECTION_VERSION = "2026-08-24";

export const SSO_CONNECTION_PROJECTION_NAME = "ssoConnectionState" as const;

/**
 * EVERY member of the wire union, and a test holds it to that
 * (`ssoConnectionCommandWiring.unit.test.ts`, alongside the command pin).
 * Five events once sat in the union and not in this list — the arrivals
 * answer, a withdrawal, and the three re-check verdicts — and an unlisted
 * event is not an error anywhere: it is stored, the projection is never
 * handed it, and the head silently stops being the truth. The customer met
 * that as an answer that saved and then read back unchanged.
 */
export const ssoConnectionEvents = [
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainWithdrawnEventSchema,
  domainVerifiedEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
  connectionArrivalPolicySetEventSchema,
  domainProofWaveredEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
] as const;

/** The compiler's half of the pin: a union member missing from the list
 *  above is named in the error here. The unit test holds the other
 *  direction (nothing subscribed outside the union). */
const _foldsWholeUnion: FoldsWholeUnion<
  SsoConnectionEvent,
  typeof ssoConnectionEvents
> = true;
void _foldsWholeUnion;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type SsoConnectionFoldState = SsoConnectionState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The connection pipeline's operational projection (D04, ADR-117 §5): one
 * Postgres `SsoConnection` row per connection, applied through
 * `.withProjection()`'s direct load/apply/store cycle under the queue's
 * per-connection lock.
 *
 * A pure event-truth head with whole-row replay semantics, exactly like the
 * identity pipeline's `Identifier`: every column is fold-written and rows are
 * never deleted — TORN_DOWN is a tombstone the router reads as INACTIVE, not
 * an absence.
 *
 * Every handler is the same move: validate the wire event and hand it to
 * `@langwatch/identity`'s reducer — live dispatch, the queue's fold and the
 * replay proof run the identical function.
 */
export class SsoConnectionStateFoldProjection
  extends AbstractFoldProjection<
    SsoConnectionFoldState,
    typeof ssoConnectionEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<SsoConnectionFoldState>
  >
  implements
    FoldEventHandlers<typeof ssoConnectionEvents, SsoConnectionFoldState>
{
  readonly name = SSO_CONNECTION_PROJECTION_NAME;
  readonly version = SSO_CONNECTION_PROJECTION_VERSION;
  readonly store: StateProjectionStore<SsoConnectionFoldState>;

  protected readonly events = ssoConnectionEvents;

  constructor(deps: { store: StateProjectionStore<SsoConnectionFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptySsoConnection({ connectionId: "" });
  }

  private fold(
    event: SsoConnectionEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    const parsed = ssoConnectionEventSchema.parse(event);
    const next = reduceSsoConnection({
      state,
      fact: { ...parsed, occurredAt: parsed.occurredAt } as never,
    });
    return {
      ...state,
      ...next,
      // init() cannot know the connection; the first applied event does.
      connectionId:
        next.connectionId === "" ? parsed.aggregateId : next.connectionId,
    };
  }

  handleIdentityConnectionRegistered(
    event: ConnectionRegisteredEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainClaimed(
    event: DomainClaimedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainClaimApproved(
    event: DomainClaimApprovedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainClaimRejected(
    event: DomainClaimRejectedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionDiscarded(
    event: ConnectionDiscardedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityVerificationRequested(
    event: VerificationRequestedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainAttested(
    event: DomainAttestedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainVerified(
    event: DomainVerifiedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionActivated(
    event: ConnectionActivatedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionSuspended(
    event: ConnectionSuspendedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionResumed(
    event: ConnectionResumedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityTeardownRequested(
    event: TeardownRequestedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionTornDown(
    event: ConnectionTornDownEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainWithdrawn(
    event: DomainWithdrawnEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionArrivalPolicySet(
    event: ConnectionArrivalPolicySetEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainProofWavered(
    event: DomainProofWaveredEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainProofLapsed(
    event: DomainProofLapsedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityDomainProofRecovered(
    event: DomainProofRecoveredEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }
}
