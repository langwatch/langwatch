import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_EVENT_VERSION_LATEST,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  connectionActivatedPayloadSchema,
  connectionDiscardedPayloadSchema,
  connectionRegisteredPayloadSchema,
  connectionResumedPayloadSchema,
  connectionSuspendedPayloadSchema,
  connectionTornDownPayloadSchema,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  domainAttestedPayloadSchema,
  domainClaimApprovedPayloadSchema,
  domainClaimedPayloadSchema,
  domainClaimRejectedPayloadSchema,
  domainVerifiedPayloadSchema,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionState,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  teardownRequestedPayloadSchema,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity-contract";
import {
  AbstractFoldProjection,
  createTenantId,
  eventIdempotencyKey,
  EventSchema,
  EventUtils,
  type FoldEventHandlers,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { z } from "zod";

/**
 * The connection pipeline's wire schemas: the framework envelope (id, aggregate, tenant, cursor
 * time) over the payloads `@langwatch/identity-contract` declares.
 */

export const connectionRegisteredEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_REGISTERED_EVENT_TYPE),
  data: connectionRegisteredPayloadSchema,
});
export type ConnectionRegisteredEvent = z.infer<typeof connectionRegisteredEventSchema>;

export const domainClaimedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIMED_EVENT_TYPE),
  data: domainClaimedPayloadSchema,
});
export type DomainClaimedEvent = z.infer<typeof domainClaimedEventSchema>;

export const domainClaimApprovedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIM_APPROVED_EVENT_TYPE),
  data: domainClaimApprovedPayloadSchema,
});
export type DomainClaimApprovedEvent = z.infer<typeof domainClaimApprovedEventSchema>;

export const domainClaimRejectedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_CLAIM_REJECTED_EVENT_TYPE),
  data: domainClaimRejectedPayloadSchema,
});
export type DomainClaimRejectedEvent = z.infer<typeof domainClaimRejectedEventSchema>;

export const connectionDiscardedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_DISCARDED_EVENT_TYPE),
  data: connectionDiscardedPayloadSchema,
});
export type ConnectionDiscardedEvent = z.infer<typeof connectionDiscardedEventSchema>;

export const verificationRequestedEventSchema = EventSchema.extend({
  type: z.literal(VERIFICATION_REQUESTED_EVENT_TYPE),
  data: verificationRequestedPayloadSchema,
});
export type VerificationRequestedEvent = z.infer<typeof verificationRequestedEventSchema>;

export const domainAttestedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_ATTESTED_EVENT_TYPE),
  data: domainAttestedPayloadSchema,
});
export type DomainAttestedEvent = z.infer<typeof domainAttestedEventSchema>;

export const domainVerifiedEventSchema = EventSchema.extend({
  type: z.literal(DOMAIN_VERIFIED_EVENT_TYPE),
  data: domainVerifiedPayloadSchema,
});
export type DomainVerifiedEvent = z.infer<typeof domainVerifiedEventSchema>;

export const connectionActivatedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_ACTIVATED_EVENT_TYPE),
  data: connectionActivatedPayloadSchema,
});
export type ConnectionActivatedEvent = z.infer<typeof connectionActivatedEventSchema>;

export const connectionSuspendedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_SUSPENDED_EVENT_TYPE),
  data: connectionSuspendedPayloadSchema,
});
export type ConnectionSuspendedEvent = z.infer<typeof connectionSuspendedEventSchema>;

export const connectionResumedEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_RESUMED_EVENT_TYPE),
  data: connectionResumedPayloadSchema,
});
export type ConnectionResumedEvent = z.infer<typeof connectionResumedEventSchema>;

export const teardownRequestedEventSchema = EventSchema.extend({
  type: z.literal(TEARDOWN_REQUESTED_EVENT_TYPE),
  data: teardownRequestedPayloadSchema,
});
export type TeardownRequestedEvent = z.infer<typeof teardownRequestedEventSchema>;

export const connectionTornDownEventSchema = EventSchema.extend({
  type: z.literal(CONNECTION_TORN_DOWN_EVENT_TYPE),
  data: connectionTornDownPayloadSchema,
});
export type ConnectionTornDownEvent = z.infer<typeof connectionTornDownEventSchema>;

export const ssoConnectionEventSchema = z.discriminatedUnion("type", [
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainVerifiedEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
]);
export type SsoConnectionEvent = z.infer<typeof ssoConnectionEventSchema>;

const SSO_CONNECTION_PROJECTION_VERSION = "2026-08-24";

export const SSO_CONNECTION_PROJECTION_NAME = "ssoConnectionState" as const;

const ssoConnectionEvents = [
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainVerifiedEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type SsoConnectionFoldState = SsoConnectionState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

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

  protected initState() {
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

  /**
   * The ONE place a connection fact becomes a framework event: the guards
   * (`SsoConnectionGuards`) decide what a command states, and this stamps the
   * envelope, so every producer stamps a fact identically.
   */
  static eventsFor({
    command,
    facts,
  }: {
    command: SsoConnectionCommand;
    facts: SsoConnectionFactInput[];
  }): SsoConnectionEvent[] {
    const { connectionId, tenantId, commandId, occurredAtMs } = command.data;
    return facts.map(
      (fact, index) =>
        EventUtils.createEvent({
          aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
          aggregateId: connectionId,
          tenantId: createTenantId(tenantId),
          type: fact.type,
          version: SSO_CONNECTION_EVENT_VERSION_LATEST,
          data: fact.data,
          metadata: {},
          occurredAt: occurredAtMs,
          idempotencyKey: eventIdempotencyKey({ commandId, index }),
        }) as SsoConnectionEvent,
    );
  }
}
