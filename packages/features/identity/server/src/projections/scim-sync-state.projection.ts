import {
  emptyScimSync,
  reduceScimSync,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_EVENT_VERSION_LATEST,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  scimApplyFailedPayloadSchema,
  scimApplyRecoveredPayloadSchema,
  scimApplyRetiredPayloadSchema,
  scimGroupMappedPayloadSchema,
  type ScimSyncCommand,
  type ScimSyncFactInput,
  type ScimSyncState,
  scimTokenIssuedPayloadSchema,
  scimTokenRevokedPayloadSchema,
  scimUserPushedPayloadSchema,
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
 * The directory-sync pipeline's wire schemas: the framework envelope (id,
 * aggregate, tenant, cursor time) over the payloads `@langwatch/identity-contract`
 * declares. Defined here, beside the fold that is their one collector, for
 * the reason every other identity pipeline's events live beside its own
 * fold: the pipeline definition adapter builds itself FROM this projection,
 * so an import back the other way would be a cycle.
 */

export const scimTokenIssuedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_TOKEN_ISSUED_EVENT_TYPE),
  data: scimTokenIssuedPayloadSchema,
});
export type ScimTokenIssuedEvent = z.infer<typeof scimTokenIssuedEventSchema>;

export const scimUserPushedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_USER_PUSHED_EVENT_TYPE),
  data: scimUserPushedPayloadSchema,
});
export type ScimUserPushedEvent = z.infer<typeof scimUserPushedEventSchema>;

export const scimGroupMappedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_GROUP_MAPPED_EVENT_TYPE),
  data: scimGroupMappedPayloadSchema,
});
export type ScimGroupMappedEvent = z.infer<typeof scimGroupMappedEventSchema>;

export const scimApplyFailedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_FAILED_EVENT_TYPE),
  data: scimApplyFailedPayloadSchema,
});
export type ScimApplyFailedEvent = z.infer<typeof scimApplyFailedEventSchema>;

export const scimApplyRecoveredEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_RECOVERED_EVENT_TYPE),
  data: scimApplyRecoveredPayloadSchema,
});
export type ScimApplyRecoveredEvent = z.infer<typeof scimApplyRecoveredEventSchema>;

export const scimApplyRetiredEventSchema = EventSchema.extend({
  type: z.literal(SCIM_APPLY_RETIRED_EVENT_TYPE),
  data: scimApplyRetiredPayloadSchema,
});
export type ScimApplyRetiredEvent = z.infer<typeof scimApplyRetiredEventSchema>;

export const scimTokenRevokedEventSchema = EventSchema.extend({
  type: z.literal(SCIM_TOKEN_REVOKED_EVENT_TYPE),
  data: scimTokenRevokedPayloadSchema,
});
export type ScimTokenRevokedEvent = z.infer<typeof scimTokenRevokedEventSchema>;

export const scimSyncEventSchema = z.discriminatedUnion("type", [
  scimTokenIssuedEventSchema,
  scimUserPushedEventSchema,
  scimGroupMappedEventSchema,
  scimApplyFailedEventSchema,
  scimApplyRecoveredEventSchema,
  scimApplyRetiredEventSchema,
  scimTokenRevokedEventSchema,
]);
export type ScimSyncEvent = z.infer<typeof scimSyncEventSchema>;

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

  private fold(event: ScimSyncEvent, state: ScimSyncFoldState): ScimSyncFoldState {
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

/**
 * The ONE place a directory-sync fact becomes a framework event: the guards
 * (`ScimSyncGuards`) decide what a command states, and this stamps the
 * envelope from the command that produced it — the aggregate type the store
 * validates (#7406), the sync as aggregate, the organization as tenant, the
 * command's business time, and the `commandId:index` idempotency key.
 *
 * Both the pipeline's command handlers (the staged re-run) and the app's
 * ledger writer (the calling path) go through here, so the two legs cannot
 * stamp a fact differently.
 *
 * Defined here, beside the fold and the schemas it stamps, rather than in
 * the pipeline definition adapter: the intents that call this ARE inputs to
 * that adapter's pipeline builder, so an import back the other way would be
 * a cycle.
 */
export function scimSyncEventsFor({
  command,
  facts,
}: {
  command: ScimSyncCommand;
  facts: ScimSyncFactInput[];
}): ScimSyncEvent[] {
  const { scimSyncId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
        aggregateId: scimSyncId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: SCIM_SYNC_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as ScimSyncEvent,
  );
}
