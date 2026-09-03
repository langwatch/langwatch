import {
  BACKUP_CODE_CONSUMED_EVENT_TYPE,
  BACKUP_CODES_REGENERATED_EVENT_TYPE,
  backupCodeConsumedPayloadSchema,
  backupCodesRegeneratedPayloadSchema,
  emptyMfaEnrollment,
  MFA_CONFIRMED_EVENT_TYPE,
  MFA_DISABLED_EVENT_TYPE,
  MFA_ENROLLED_EVENT_TYPE,
  MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
  MFA_EVENT_VERSION_LATEST,
  MFA_VERIFICATION_FAILED_EVENT_TYPE,
  mfaConfirmedPayloadSchema,
  mfaDisabledPayloadSchema,
  type MfaCommand,
  type MfaEnrollmentState,
  mfaEnrolledPayloadSchema,
  mfaEnrollmentExpiredPayloadSchema,
  type MfaFactInput,
  mfaVerificationFailedPayloadSchema,
  reduceMfaEnrollment,
  USER_IDENTITY_AGGREGATE_TYPE,
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
 * The two-step verification pipeline's wire schemas: the framework envelope
 * (id, aggregate, tenant, cursor time) over the MFA payloads
 * `@langwatch/identity-contract` declares.
 *
 * Nothing here can carry a secret or a backup code, because none of the
 * payloads it extends has a field for one.
 *
 * Defined here, beside the fold that is their one collector, for the same
 * reason the identity pipeline's events live beside its own fold: the
 * pipeline definition adapter builds itself FROM this projection, so an
 * import back the other way would be a cycle.
 */

export const mfaEnrolledEventSchema = EventSchema.extend({
  type: z.literal(MFA_ENROLLED_EVENT_TYPE),
  data: mfaEnrolledPayloadSchema,
});
export type MfaEnrolledEvent = z.infer<typeof mfaEnrolledEventSchema>;

export const mfaConfirmedEventSchema = EventSchema.extend({
  type: z.literal(MFA_CONFIRMED_EVENT_TYPE),
  data: mfaConfirmedPayloadSchema,
});
export type MfaConfirmedEvent = z.infer<typeof mfaConfirmedEventSchema>;

export const mfaEnrollmentExpiredEventSchema = EventSchema.extend({
  type: z.literal(MFA_ENROLLMENT_EXPIRED_EVENT_TYPE),
  data: mfaEnrollmentExpiredPayloadSchema,
});
export type MfaEnrollmentExpiredEvent = z.infer<
  typeof mfaEnrollmentExpiredEventSchema
>;

export const mfaDisabledEventSchema = EventSchema.extend({
  type: z.literal(MFA_DISABLED_EVENT_TYPE),
  data: mfaDisabledPayloadSchema,
});
export type MfaDisabledEvent = z.infer<typeof mfaDisabledEventSchema>;

export const backupCodeConsumedEventSchema = EventSchema.extend({
  type: z.literal(BACKUP_CODE_CONSUMED_EVENT_TYPE),
  data: backupCodeConsumedPayloadSchema,
});
export type BackupCodeConsumedEvent = z.infer<
  typeof backupCodeConsumedEventSchema
>;

export const backupCodesRegeneratedEventSchema = EventSchema.extend({
  type: z.literal(BACKUP_CODES_REGENERATED_EVENT_TYPE),
  data: backupCodesRegeneratedPayloadSchema,
});
export type BackupCodesRegeneratedEvent = z.infer<
  typeof backupCodesRegeneratedEventSchema
>;

export const mfaVerificationFailedEventSchema = EventSchema.extend({
  type: z.literal(MFA_VERIFICATION_FAILED_EVENT_TYPE),
  data: mfaVerificationFailedPayloadSchema,
});
export type MfaVerificationFailedEvent = z.infer<
  typeof mfaVerificationFailedEventSchema
>;

export const mfaEventSchema = z.discriminatedUnion("type", [
  mfaEnrolledEventSchema,
  mfaConfirmedEventSchema,
  mfaEnrollmentExpiredEventSchema,
  mfaDisabledEventSchema,
  backupCodeConsumedEventSchema,
  backupCodesRegeneratedEventSchema,
  mfaVerificationFailedEventSchema,
]);
export type MfaEvent = z.infer<typeof mfaEventSchema>;

const MFA_PROJECTION_VERSION = "2026-08-24";

const mfaEvents = [
  mfaEnrolledEventSchema,
  mfaConfirmedEventSchema,
  mfaEnrollmentExpiredEventSchema,
  mfaDisabledEventSchema,
  backupCodeConsumedEventSchema,
  backupCodesRegeneratedEventSchema,
  mfaVerificationFailedEventSchema,
] as const;

/** The reducer's state plus the base class's bookkeeping stamps — server
 *  rig, deliberately outside the replay-proof reducer surface. */
export type MfaFoldState = MfaEnrollmentState & {
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/**
 * The two-step verification pipeline's operational projection (D06): one
 * Postgres row per person, applied through `.withProjection()`'s direct
 * load/apply/store cycle under the queue's per-user lock.
 *
 * A pure event-truth head — the row is never deleted, DISABLED is a
 * tombstone, and a replay rebuilds it whole-row. Every handler is the same
 * move: validate the wire event and hand it to `@langwatch/identity`'s
 * reducer, so live dispatch, the queue's fold and the replay proof all run
 * the identical function.
 */
export class MfaEnrollmentStateFoldProjection
  extends AbstractFoldProjection<
    MfaFoldState,
    typeof mfaEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<MfaFoldState>
  >
  implements FoldEventHandlers<typeof mfaEvents, MfaFoldState>
{
  readonly name = "mfaEnrollmentState";
  readonly version = MFA_PROJECTION_VERSION;
  readonly store: StateProjectionStore<MfaFoldState>;

  protected readonly events = mfaEvents;

  constructor(deps: { store: StateProjectionStore<MfaFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return emptyMfaEnrollment({ userId: "" });
  }

  private fold(event: MfaEvent, state: MfaFoldState): MfaFoldState {
    const parsed = mfaEventSchema.parse(event);
    const next = reduceMfaEnrollment({
      state,
      fact: {
        type: parsed.type,
        data: parsed.data,
        occurredAt: parsed.occurredAt,
      } as never,
    });
    return {
      ...state,
      ...next,
      // init() cannot know the person; the first applied event does.
      userId: next.userId === "" ? parsed.aggregateId : next.userId,
    };
  }

  handleIdentityMfaEnrolled(
    event: MfaEnrolledEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityMfaConfirmed(
    event: MfaConfirmedEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityMfaEnrollmentExpired(
    event: MfaEnrollmentExpiredEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityMfaDisabled(
    event: MfaDisabledEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityBackupCodeConsumed(
    event: BackupCodeConsumedEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityBackupCodesRegenerated(
    event: BackupCodesRegeneratedEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }

  handleIdentityMfaVerificationFailed(
    event: MfaVerificationFailedEvent,
    state: MfaFoldState,
  ): MfaFoldState {
    return this.fold(event, state);
  }
}

/**
 * The same envelope stamp the identity pipeline's events get, and a
 * separate function for one reason that matters: SCHEMA VERSION. An
 * envelope stamps exactly one `version`, fold read-back is version-gated,
 * and these two families evolve independently.
 *
 * They still ride `USER_IDENTITY_AGGREGATE_TYPE`, keyed on the same
 * `userId` — deliberately, and it is the whole reason this lives on the
 * identity pipeline. The queue keys its lane on the aggregate id, so a
 * person's identifier commands and their two-step commands serialise
 * against each other.
 *
 * Defined here, beside the fold and the schemas it stamps, for the same
 * reason `identityEventsFor` lives beside its own fold.
 */
export function mfaEventsFor({
  command,
  facts,
}: {
  command: MfaCommand;
  facts: MfaFactInput[];
}): MfaEvent[] {
  const { userId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: MFA_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as MfaEvent,
  );
}
