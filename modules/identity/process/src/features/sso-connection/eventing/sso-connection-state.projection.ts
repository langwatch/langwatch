import {
  AbstractFoldProjection,
  EventSchema,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RENAMED_EVENT_TYPE,
  connectionRenamedPayloadSchema,
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  connectionIdpUpdatedPayloadSchema,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  replacementConnectionRegisteredPayloadSchema,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  migrationRouteSelectedPayloadSchema,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  migrationFinalizationStartedPayloadSchema,
  MIGRATION_FINALIZED_EVENT_TYPE,
  migrationFinalizedPayloadSchema,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionArrivalPolicySetPayloadSchema,
  connectionDiscardedPayloadSchema,
  connectionRegisteredPayloadSchema,
  connectionResumedPayloadSchema,
  connectionSuspendedPayloadSchema,
  connectionTornDownPayloadSchema,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  domainAttestedPayloadSchema,
  domainWithdrawnPayloadSchema,
  domainClaimApprovedPayloadSchema,
  domainClaimedPayloadSchema,
  domainClaimRejectedPayloadSchema,
  domainProofLapsedPayloadSchema,
  domainProofRecoveredPayloadSchema,
  domainProofWaveredPayloadSchema,
  domainVerifiedPayloadSchema,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionState,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  teardownRequestedPayloadSchema,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity-contract";
import { z } from "zod";

/**
 * The connection pipeline's wire schemas: the framework envelope (id, aggregate, tenant, cursor
 * time) over the payloads `@langwatch/identity-contract` declares.
 */

export const connectionRegisteredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_REGISTERED_EVENT_TYPE),
  data: connectionRegisteredPayloadSchema,
});
type ConnectionRegisteredEvent = z.infer<typeof connectionRegisteredEventSchema>;

export const domainClaimedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_CLAIMED_EVENT_TYPE),
  data: domainClaimedPayloadSchema,
});
type DomainClaimedEvent = z.infer<typeof domainClaimedEventSchema>;

export const domainClaimApprovedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_CLAIM_APPROVED_EVENT_TYPE),
  data: domainClaimApprovedPayloadSchema,
});
type DomainClaimApprovedEvent = z.infer<typeof domainClaimApprovedEventSchema>;

export const domainClaimRejectedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_CLAIM_REJECTED_EVENT_TYPE),
  data: domainClaimRejectedPayloadSchema,
});
type DomainClaimRejectedEvent = z.infer<typeof domainClaimRejectedEventSchema>;

export const connectionDiscardedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_DISCARDED_EVENT_TYPE),
  data: connectionDiscardedPayloadSchema,
});
type ConnectionDiscardedEvent = z.infer<typeof connectionDiscardedEventSchema>;

export const verificationRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(VERIFICATION_REQUESTED_EVENT_TYPE),
  data: verificationRequestedPayloadSchema,
});
type VerificationRequestedEvent = z.infer<typeof verificationRequestedEventSchema>;

export const domainAttestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_ATTESTED_EVENT_TYPE),
  data: domainAttestedPayloadSchema,
});
type DomainAttestedEvent = z.infer<typeof domainAttestedEventSchema>;

export const domainWithdrawnEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_WITHDRAWN_EVENT_TYPE),
  data: domainWithdrawnPayloadSchema,
});
type DomainWithdrawnEvent = z.infer<typeof domainWithdrawnEventSchema>;

export const domainVerifiedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_VERIFIED_EVENT_TYPE),
  data: domainVerifiedPayloadSchema,
});
type DomainVerifiedEvent = z.infer<typeof domainVerifiedEventSchema>;

export const domainProofWaveredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_PROOF_WAVERED_EVENT_TYPE),
  data: domainProofWaveredPayloadSchema,
});
type DomainProofWaveredEvent = z.infer<typeof domainProofWaveredEventSchema>;

export const domainProofLapsedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_PROOF_LAPSED_EVENT_TYPE),
  data: domainProofLapsedPayloadSchema,
});
type DomainProofLapsedEvent = z.infer<typeof domainProofLapsedEventSchema>;

export const domainProofRecoveredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DOMAIN_PROOF_RECOVERED_EVENT_TYPE),
  data: domainProofRecoveredPayloadSchema,
});
type DomainProofRecoveredEvent = z.infer<typeof domainProofRecoveredEventSchema>;

export const connectionActivatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_ACTIVATED_EVENT_TYPE),
  data: connectionActivatedPayloadSchema,
});
type ConnectionActivatedEvent = z.infer<typeof connectionActivatedEventSchema>;

export const connectionSuspendedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_SUSPENDED_EVENT_TYPE),
  data: connectionSuspendedPayloadSchema,
});
type ConnectionSuspendedEvent = z.infer<typeof connectionSuspendedEventSchema>;

export const connectionResumedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_RESUMED_EVENT_TYPE),
  data: connectionResumedPayloadSchema,
});
type ConnectionResumedEvent = z.infer<typeof connectionResumedEventSchema>;

export const teardownRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TEARDOWN_REQUESTED_EVENT_TYPE),
  data: teardownRequestedPayloadSchema,
});
type TeardownRequestedEvent = z.infer<typeof teardownRequestedEventSchema>;

export const connectionTornDownEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTION_TORN_DOWN_EVENT_TYPE),
  data: connectionTornDownPayloadSchema,
});
type ConnectionTornDownEvent = z.infer<typeof connectionTornDownEventSchema>;

export const connectionArrivalPolicySetEventSchema = EventSchema.safeExtend({
  type: z.literal(CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE),
  data: connectionArrivalPolicySetPayloadSchema,
});
type ConnectionArrivalPolicySetEvent = z.infer<typeof connectionArrivalPolicySetEventSchema>;

export const connectionRenamedEventSchema = EventSchema.safeExtend({
  type: z.literal(CONNECTION_RENAMED_EVENT_TYPE),
  data: connectionRenamedPayloadSchema,
});
type ConnectionRenamedEvent = z.infer<typeof connectionRenamedEventSchema>;

/** What the engine dials, replaced on the same connection id. */
export const connectionIdpUpdatedEventSchema = EventSchema.safeExtend({
  type: z.literal(CONNECTION_IDP_UPDATED_EVENT_TYPE),
  data: connectionIdpUpdatedPayloadSchema,
});
type ConnectionIdpUpdatedEvent = z.infer<typeof connectionIdpUpdatedEventSchema>;

export const replacementConnectionRegisteredEventSchema = EventSchema.safeExtend({
  type: z.literal(REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE),
  data: replacementConnectionRegisteredPayloadSchema,
});
type ReplacementConnectionRegisteredEvent = z.infer<
  typeof replacementConnectionRegisteredEventSchema
>;

export const migrationRouteSelectedEventSchema = EventSchema.safeExtend({
  type: z.literal(MIGRATION_ROUTE_SELECTED_EVENT_TYPE),
  data: migrationRouteSelectedPayloadSchema,
});
type MigrationRouteSelectedEvent = z.infer<typeof migrationRouteSelectedEventSchema>;

export const migrationFinalizationStartedEventSchema = EventSchema.safeExtend({
  type: z.literal(MIGRATION_FINALIZATION_STARTED_EVENT_TYPE),
  data: migrationFinalizationStartedPayloadSchema,
});
type MigrationFinalizationStartedEvent = z.infer<typeof migrationFinalizationStartedEventSchema>;

export const migrationFinalizedEventSchema = EventSchema.safeExtend({
  type: z.literal(MIGRATION_FINALIZED_EVENT_TYPE),
  data: migrationFinalizedPayloadSchema,
});
type MigrationFinalizedEvent = z.infer<typeof migrationFinalizedEventSchema>;

export const ssoConnectionEventSchema = z.discriminatedUnion("type", [
  connectionArrivalPolicySetEventSchema,
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainWithdrawnEventSchema,
  domainVerifiedEventSchema,
  domainProofWaveredEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
  connectionRenamedEventSchema,
  connectionIdpUpdatedEventSchema,
  replacementConnectionRegisteredEventSchema,
  migrationRouteSelectedEventSchema,
  migrationFinalizationStartedEventSchema,
  migrationFinalizedEventSchema,
]);
export type SsoConnectionEvent = z.infer<typeof ssoConnectionEventSchema>;

const SSO_CONNECTION_PROJECTION_VERSION = "2026-08-24";

const SSO_CONNECTION_PROJECTION_NAME = "ssoConnectionState" as const;

const ssoConnectionEvents = [
  connectionArrivalPolicySetEventSchema,
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainWithdrawnEventSchema,
  domainVerifiedEventSchema,
  domainProofWaveredEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
  connectionRenamedEventSchema,
  connectionIdpUpdatedEventSchema,
  replacementConnectionRegisteredEventSchema,
  migrationRouteSelectedEventSchema,
  migrationFinalizationStartedEventSchema,
  migrationFinalizedEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type SsoConnectionFoldState = SsoConnectionState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
  /** Recovery reservations carried by activation events in this fold batch;
   *  the store consumes them in the same transaction as the head. */
  ActivationReservationCommandIds?: readonly string[];
};

function withReservationCommandId(
  held: readonly string[] | undefined,
  commandId: string | undefined,
): readonly string[] {
  const reservations = held ?? [];
  if (commandId === undefined || reservations.includes(commandId)) return reservations;
  return [...reservations, commandId];
}

/**
 * Postgres `SsoConnection` row per connection, applied through `.withProjection()`'s direct
 * load/apply/store cycle under the queue's per-connection lock.
 * The connection pipeline's operational projection (D04, ADR-117 §5): one
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
  implements FoldEventHandlers<typeof ssoConnectionEvents, SsoConnectionFoldState>
{
  readonly name = SSO_CONNECTION_PROJECTION_NAME;
  readonly version = SSO_CONNECTION_PROJECTION_VERSION;
  readonly store: StateProjectionStore<SsoConnectionFoldState>;

  protected readonly events = ssoConnectionEvents;

  static create(deps: {
    store: StateProjectionStore<SsoConnectionFoldState>;
  }): SsoConnectionStateFoldProjection {
    return new SsoConnectionStateFoldProjection(deps);
  }

  constructor(deps: { store: StateProjectionStore<SsoConnectionFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState(): SsoConnectionState {
    return emptySsoConnection({ connectionId: "" });
  }

  private fold(event: SsoConnectionEvent, state: SsoConnectionFoldState): SsoConnectionFoldState {
    const parsed = ssoConnectionEventSchema.parse(event);
    const next = reduceSsoConnection({
      state,
      fact: { ...parsed, occurredAt: parsed.occurredAt } as never,
    });
    return {
      ...state,
      ...next,
      // init() cannot know the connection; the first applied event does.
      connectionId: next.connectionId === "" ? parsed.aggregateId : next.connectionId,
    };
  }

  handleIdentityConnectionRegistered(
    event: ConnectionRegisteredEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionRenamed(
    event: ConnectionRenamedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityConnectionIdpUpdated(
    event: ConnectionIdpUpdatedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityReplacementConnectionRegistered(
    event: ReplacementConnectionRegisteredEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityMigrationRouteSelected(
    event: MigrationRouteSelectedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityMigrationFinalizationStarted(
    event: MigrationFinalizationStartedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return this.fold(event, state);
  }

  handleIdentityMigrationFinalized(
    event: MigrationFinalizedEvent,
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

  handleIdentityDomainWithdrawn(
    event: DomainWithdrawnEvent,
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

  handleIdentityConnectionActivated(
    event: ConnectionActivatedEvent,
    state: SsoConnectionFoldState,
  ): SsoConnectionFoldState {
    return {
      ...this.fold(event, state),
      ActivationReservationCommandIds: withReservationCommandId(
        state.ActivationReservationCommandIds,
        event.data.activationReservationCommandId,
      ),
    };
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
    return {
      ...this.fold(event, state),
      ActivationReservationCommandIds: withReservationCommandId(
        state.ActivationReservationCommandIds,
        event.data.activationReservationCommandId,
      ),
    };
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
}
