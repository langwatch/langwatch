import {
  emptyMfaEnrollment,
  type MfaEnrollmentState,
  reduceMfaEnrollment,
} from "@langwatch/identity";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  type BackupCodeConsumedEvent,
  type BackupCodesRegeneratedEvent,
  backupCodeConsumedEventSchema,
  backupCodesRegeneratedEventSchema,
  type MfaConfirmedEvent,
  type MfaDisabledEvent,
  type MfaEnrolledEvent,
  type MfaEnrollmentExpiredEvent,
  type MfaEvent,
  type MfaVerificationFailedEvent,
  mfaConfirmedEventSchema,
  mfaDisabledEventSchema,
  mfaEnrolledEventSchema,
  mfaEnrollmentExpiredEventSchema,
  mfaEventSchema,
  mfaVerificationFailedEventSchema,
} from "../schemas/mfaEvents";

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
