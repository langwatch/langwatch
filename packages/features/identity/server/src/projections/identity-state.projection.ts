import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  emptyIdentityHeads,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  identifierAttachedPayloadSchema,
  identifierDeadEndedPayloadSchema,
  identifierDetachedPayloadSchema,
  identifierVerifiedPayloadSchema,
  type IdentityCommand,
  type IdentityFactInput,
  type IdentityHeads,
  IDENTITY_EVENT_VERSION_LATEST,
  LINK_PROPOSED_EVENT_TYPE,
  linkProposedPayloadSchema,
  PRIMARY_CHANGED_EVENT_TYPE,
  primaryChangedPayloadSchema,
  reduceIdentity,
  USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
  userErasedPayloadSchema,
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
 * The identity pipeline's wire schemas: the framework envelope (id, aggregate, tenant, cursor time)
 * over the payloads `@langwatch/identity-contract` declares. What a fact SAYS is the contract's;
 * how it travels the event log is the framework's, and this file is where the two meet.
 */

export const identifierAttachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_ATTACHED_EVENT_TYPE),
  data: identifierAttachedPayloadSchema,
});
export type IdentifierAttachedEvent = z.infer<typeof identifierAttachedEventSchema>;

export const identifierVerifiedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_VERIFIED_EVENT_TYPE),
  data: identifierVerifiedPayloadSchema,
});
export type IdentifierVerifiedEvent = z.infer<typeof identifierVerifiedEventSchema>;

export const identifierDeadEndedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DEAD_ENDED_EVENT_TYPE),
  data: identifierDeadEndedPayloadSchema,
});
export type IdentifierDeadEndedEvent = z.infer<typeof identifierDeadEndedEventSchema>;

export const primaryChangedEventSchema = EventSchema.extend({
  type: z.literal(PRIMARY_CHANGED_EVENT_TYPE),
  data: primaryChangedPayloadSchema,
});
export type PrimaryChangedEvent = z.infer<typeof primaryChangedEventSchema>;

export const identifierDetachedEventSchema = EventSchema.extend({
  type: z.literal(IDENTIFIER_DETACHED_EVENT_TYPE),
  data: identifierDetachedPayloadSchema,
});
export type IdentifierDetachedEvent = z.infer<typeof identifierDetachedEventSchema>;

export const userErasedEventSchema = EventSchema.extend({
  type: z.literal(USER_ERASED_EVENT_TYPE),
  data: userErasedPayloadSchema,
});
export type UserErasedEvent = z.infer<typeof userErasedEventSchema>;

export const linkProposedEventSchema = EventSchema.extend({
  type: z.literal(LINK_PROPOSED_EVENT_TYPE),
  data: linkProposedPayloadSchema,
});
export type LinkProposedEvent = z.infer<typeof linkProposedEventSchema>;

export const identityEventSchema = z.discriminatedUnion("type", [
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
  linkProposedEventSchema,
]);
export type IdentityEvent = z.infer<typeof identityEventSchema>;

const IDENTITY_PROJECTION_VERSION = "2026-08-20";

const identityEvents = [
  identifierAttachedEventSchema,
  identifierVerifiedEventSchema,
  identifierDeadEndedEventSchema,
  primaryChangedEventSchema,
  identifierDetachedEventSchema,
  userErasedEventSchema,
  linkProposedEventSchema,
] as const;

/** The reducer's heads plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type IdentityFoldState = IdentityHeads & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * state per user,
 * The identity pipeline's operational projection (ADR-101 §3): one Postgres
 * replay semantics, ADR-022/015 unamended.
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

  static create(deps: {
    store: StateProjectionStore<IdentityFoldState>;
  }): IdentityStateFoldProjection {
    return new IdentityStateFoldProjection(deps);
  }

  constructor(deps: { store: StateProjectionStore<IdentityFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyIdentityHeads({ userId: "" });
  }

  private fold(event: IdentityEvent, state: IdentityFoldState): IdentityFoldState {
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

  handleIdentityUserErased(event: UserErasedEvent, state: IdentityFoldState): IdentityFoldState {
    return this.fold(event, state);
  }

  /**
   * Folded like every other fact, and the reducer leaves the heads alone: a proposal states that no
   * identifier was attached.
   */
  handleIdentityLinkProposed(
    event: LinkProposedEvent,
    state: IdentityFoldState,
  ): IdentityFoldState {
    return this.fold(event, state);
  }

  /**
   * The ONE place an identity fact becomes a framework event: the guards
   * (`IdentityGuards`) decide what a command states, and this stamps the
   * envelope, so both the staged re-run and the calling path stamp identically.
   */
  static eventsFor({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): IdentityEvent[] {
    const { userId, tenantId, commandId, occurredAtMs } = command.data;
    // The ceremony context the adapter stamped (ADR-101 §2: why the row was
    // written) rides as metadata on the attach - never in the fact itself.
    const metadata =
      command.type === ATTACH_IDENTIFIER_COMMAND_TYPE
        ? {
            ceremonyFlow: command.data.ceremony.flow,
            ...(command.data.ceremony.requestId
              ? { requestId: command.data.ceremony.requestId }
              : {}),
          }
        : {};
    return facts.map(
      (fact, index) =>
        EventUtils.createEvent({
          aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
          aggregateId: userId,
          tenantId: createTenantId(tenantId),
          type: fact.type,
          version: IDENTITY_EVENT_VERSION_LATEST,
          data: fact.data,
          metadata,
          occurredAt: occurredAtMs,
          idempotencyKey: eventIdempotencyKey({ commandId, index }),
        }) as IdentityEvent,
    );
  }
}
