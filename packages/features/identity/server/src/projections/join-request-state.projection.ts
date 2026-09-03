import {
  emptyJoinRequest,
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_APPROVED_EVENT_TYPE,
  joinApprovedPayloadSchema,
  JOIN_EXPIRED_EVENT_TYPE,
  joinExpiredPayloadSchema,
  JOIN_REJECTED_EVENT_TYPE,
  joinRejectedPayloadSchema,
  JOIN_REQUEST_EVENT_VERSION_LATEST,
  JOIN_REQUESTED_EVENT_TYPE,
  type JoinRequestAggregateState,
  type JoinRequestCommand,
  type JoinRequestFactInput,
  joinRequestedPayloadSchema,
  JOIN_WITHDRAWN_EVENT_TYPE,
  joinWithdrawnPayloadSchema,
  reduceJoinRequest,
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
 * The join-request pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity-contract`
 * declares. Defined here, beside the fold that is their one collector, for
 * the reason every other identity pipeline's events live beside its own
 * fold: the pipeline definition adapter builds itself FROM this projection,
 * so an import back the other way would be a cycle.
 *
 * Time lives on the envelope: `occurredAt` is business time (an expiry
 * carries the deadline it was scheduled for, not the moment the worker got
 * round to it), `createdAt` is ledger-accepted time.
 */

export const joinRequestedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_REQUESTED_EVENT_TYPE),
  data: joinRequestedPayloadSchema,
});
export type JoinRequestedEvent = z.infer<typeof joinRequestedEventSchema>;

export const joinApprovedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_APPROVED_EVENT_TYPE),
  data: joinApprovedPayloadSchema,
});
export type JoinApprovedEvent = z.infer<typeof joinApprovedEventSchema>;

export const joinRejectedEventSchema = EventSchema.extend({
  type: z.literal(JOIN_REJECTED_EVENT_TYPE),
  data: joinRejectedPayloadSchema,
});
export type JoinRejectedEvent = z.infer<typeof joinRejectedEventSchema>;

export const joinExpiredEventSchema = EventSchema.extend({
  type: z.literal(JOIN_EXPIRED_EVENT_TYPE),
  data: joinExpiredPayloadSchema,
});
export type JoinExpiredEvent = z.infer<typeof joinExpiredEventSchema>;

export const joinWithdrawnEventSchema = EventSchema.extend({
  type: z.literal(JOIN_WITHDRAWN_EVENT_TYPE),
  data: joinWithdrawnPayloadSchema,
});
export type JoinWithdrawnEvent = z.infer<typeof joinWithdrawnEventSchema>;

export const joinRequestEventSchema = z.discriminatedUnion("type", [
  joinRequestedEventSchema,
  joinApprovedEventSchema,
  joinRejectedEventSchema,
  joinExpiredEventSchema,
  joinWithdrawnEventSchema,
]);
export type JoinRequestEvent = z.infer<typeof joinRequestEventSchema>;

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

/**
 * The ONE place a join-request fact becomes a framework event: the guards
 * (`JoinRequestGuards`) decide what a command states, and this stamps the
 * envelope from the command that produced it — the aggregate type the store
 * validates, the request as aggregate, the organization as tenant, the
 * command's business time, and the `commandId:index` idempotency key.
 *
 * Both the pipeline's command handlers (the staged re-run) and the app's
 * ledger writer (the calling path) go through here, so the two legs cannot
 * stamp a fact differently — and a retried approval derives identical keys,
 * which is the whole of "a replayed approval attaches membership exactly
 * once".
 *
 * Defined here, beside the fold and the schemas it stamps, rather than in
 * the pipeline definition adapter: the intents that call this ARE inputs to
 * that adapter's pipeline builder, so an import back the other way would be
 * a cycle.
 */
export function joinRequestEventsFor({
  command,
  facts,
}: {
  command: JoinRequestCommand;
  facts: JoinRequestFactInput[];
}): JoinRequestEvent[] {
  const { joinRequestId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: JOIN_REQUEST_AGGREGATE_TYPE,
        aggregateId: joinRequestId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: JOIN_REQUEST_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as JoinRequestEvent,
  );
}
