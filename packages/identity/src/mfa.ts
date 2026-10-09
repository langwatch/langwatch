import { z } from "zod";
import { userTenantedCommandSchema } from "./facts";
import { identityActorSchema } from "./vocabulary";

/**
 * The two-step verification facts (D06). One enrollment per PERSON: the
 * aggregate is tenanted by the user, exactly like `user_identity`, because
 * that is what better-auth models — `TwoFactor` is keyed on `userId` and
 * `twoFactorEnabled` is a column on `User`. No organization holds a copy.
 *
 * The consequence is what keeps this small. If an account is ENABLED, every
 * sign-in for it is challenged, so a session for that person that never
 * answered a challenge cannot exist. There is nothing to step up, and so
 * there is no freshness timestamp and no per-session policy anywhere here.
 *
 * What the facts carry is the LIFECYCLE and nothing else. The shared secret
 * and the backup codes are protocol state: they live at rest in the
 * two-factor plugin's own table, row-truth for good (ADR-101 R12), and no
 * fact in this module has a field that could hold one. `codeIndex` on a
 * consumption is a POSITION, not a code — it is what lets "how many are
 * left" be answered from the log without the log ever knowing a code.
 */

export const MFA_ENROLLED_EVENT_TYPE = "lw.identity.mfa_enrolled" as const;
export const MFA_CONFIRMED_EVENT_TYPE = "lw.identity.mfa_confirmed" as const;
export const MFA_ENROLLMENT_EXPIRED_EVENT_TYPE =
  "lw.identity.mfa_enrollment_expired" as const;
export const MFA_DISABLED_EVENT_TYPE = "lw.identity.mfa_disabled" as const;
export const BACKUP_CODE_CONSUMED_EVENT_TYPE =
  "lw.identity.backup_code_consumed" as const;
export const BACKUP_CODES_REGENERATED_EVENT_TYPE =
  "lw.identity.backup_codes_regenerated" as const;
export const MFA_VERIFICATION_FAILED_EVENT_TYPE =
  "lw.identity.mfa_verification_failed" as const;

export const MFA_EVENT_TYPES = [
  MFA_ENROLLED_EVENT_TYPE,
  MFA_CONFIRMED_EVENT_TYPE,
  MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
  MFA_DISABLED_EVENT_TYPE,
  BACKUP_CODE_CONSUMED_EVENT_TYPE,
  BACKUP_CODES_REGENERATED_EVENT_TYPE,
  MFA_VERIFICATION_FAILED_EVENT_TYPE,
] as const;
export type MfaEventType = (typeof MFA_EVENT_TYPES)[number];

export const MFA_EVENT_VERSION_LATEST = "2026-08-24" as const;

/**
 * An authenticator code, and that is the whole list. Never a text message —
 * spelled as a one-value enum rather than a string so adding SMS is a
 * deliberate edit here rather than a caller passing a different word.
 */
export const mfaMethodSchema = z.enum(["totp"]);
export type MfaMethod = z.infer<typeof mfaMethodSchema>;

/**
 * How an enrollment ended. `password+totp` is the person themselves, having
 * re-proved both; `org-admin` is an administrator's reset for somebody whose
 * authenticator is gone. The distinction is the audit trail's whole point,
 * so it is a fact rather than something inferred from the actor's shape.
 */
export const mfaDisableViaSchema = z.enum(["password+totp", "org-admin"]);
export type MfaDisableVia = z.infer<typeof mfaDisableViaSchema>;

export const mfaEnrolledPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  userId: z.string().min(1),
  /** The method, and nothing else about it: no secret, no issuer, no URI. */
  method: mfaMethodSchema,
  actor: identityActorSchema,
});

export const mfaConfirmedPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  /** How many backup codes were issued alongside the confirmation. A COUNT,
   *  so "how many are left" subtracts the consumed positions without any
   *  code ever being stated. */
  backupCodeCount: z.number().int().nonnegative(),
  actor: identityActorSchema,
});

export const mfaEnrollmentExpiredPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
});

export const mfaDisabledPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  via: mfaDisableViaSchema,
  actor: identityActorSchema,
});

export const backupCodeConsumedPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  /** WHICH code was spent, by position. Never the code. */
  codeIndex: z.number().int().nonnegative(),
});

/**
 * A fresh set replaced whatever was left. Not in D06's original event list,
 * and added because the spec asks for "Regenerating replaces every code that
 * was left" to be real: the plugin overwrites its own column on its own, but
 * the consumed POSITIONS live here, and without this fact they would carry
 * over onto a new set and make "how many are left" a lie.
 */
export const backupCodesRegeneratedPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  backupCodeCount: z.number().int().nonnegative(),
  actor: identityActorSchema,
});

/**
 * Evidence of a failure, and none of it is the value that was entered. The
 * count is the plugin's own `failedVerificationCount` as it stood after the
 * attempt — lockout is the plugin's to enforce, and this is the log of it.
 */
export const mfaVerificationFailedPayloadSchema = z.object({
  enrollmentId: z.string().min(1),
  failedCount: z.number().int().nonnegative(),
});

export const mfaFactInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(MFA_ENROLLED_EVENT_TYPE),
    data: mfaEnrolledPayloadSchema,
  }),
  z.object({
    type: z.literal(MFA_CONFIRMED_EVENT_TYPE),
    data: mfaConfirmedPayloadSchema,
  }),
  z.object({
    type: z.literal(MFA_ENROLLMENT_EXPIRED_EVENT_TYPE),
    data: mfaEnrollmentExpiredPayloadSchema,
  }),
  z.object({
    type: z.literal(MFA_DISABLED_EVENT_TYPE),
    data: mfaDisabledPayloadSchema,
  }),
  z.object({
    type: z.literal(BACKUP_CODE_CONSUMED_EVENT_TYPE),
    data: backupCodeConsumedPayloadSchema,
  }),
  z.object({
    type: z.literal(BACKUP_CODES_REGENERATED_EVENT_TYPE),
    data: backupCodesRegeneratedPayloadSchema,
  }),
  z.object({
    type: z.literal(MFA_VERIFICATION_FAILED_EVENT_TYPE),
    data: mfaVerificationFailedPayloadSchema,
  }),
]);
export type MfaFactInput = z.infer<typeof mfaFactInputSchema>;

/** A fact with its business time — what the reducer folds. */
export type MfaFact = MfaFactInput & { occurredAt: number };

export type MfaFactOf<T extends MfaEventType> = Extract<MfaFact, { type: T }>;

/**
 * Where an enrollment stands.
 *
 *   [*] ──► PENDING ──a correct code confirms──► ENABLED
 *              └──24h wake, never confirmed──► EXPIRED
 *   ENABLED ──password + a correct code, or an administrator's reset──► DISABLED
 *
 * `NONE` is the state of somebody who never started one; it is a real value
 * rather than a null so every read answers the same question the same way.
 */
export const MFA_ENROLLMENT_STATES = [
  "NONE",
  "PENDING",
  "ENABLED",
  "EXPIRED",
  "DISABLED",
] as const;
export type MfaEnrollmentLifecycleState = (typeof MFA_ENROLLMENT_STATES)[number];

/**
 * One person's two-step verification, as the projection knows it. Every
 * field is a lifecycle fact; there is deliberately nowhere here a secret or
 * a code could be put, which is what makes "no rebuilt row holds a secret or
 * a code" a property of the type rather than of a test.
 */
export interface MfaEnrollmentState {
  userId: string;
  enrollmentId: string | null;
  method: MfaMethod | null;
  state: MfaEnrollmentLifecycleState;
  enrolledAtMs: number | null;
  confirmedAtMs: number | null;
  expiredAtMs: number | null;
  disabledAtMs: number | null;
  /** How the enrollment ended, when it has. */
  disabledVia: MfaDisableVia | null;
  /** How many codes the current set holds. */
  backupCodeCount: number;
  /** Positions already spent, ascending. Never codes. */
  consumedBackupCodeIndexes: number[];
  /** Consecutive failures, as the last failure counted them. */
  failedCount: number;
}

export function emptyMfaEnrollment({
  userId,
}: {
  userId: string;
}): MfaEnrollmentState {
  return {
    userId,
    enrollmentId: null,
    method: null,
    state: "NONE",
    enrolledAtMs: null,
    confirmedAtMs: null,
    expiredAtMs: null,
    disabledAtMs: null,
    disabledVia: null,
    backupCodeCount: 0,
    consumedBackupCodeIndexes: [],
    failedCount: 0,
  };
}

/** How many backup codes the person can still use. */
export function remainingBackupCodes(state: MfaEnrollmentState): number {
  return Math.max(
    0,
    state.backupCodeCount - state.consumedBackupCodeIndexes.length,
  );
}

/**
 * Whether this account can prove a second factor on its own — the account
 * half of an organization's membership condition. Only ENABLED counts: a
 * setup that was started and never confirmed proves nothing, and one that
 * was turned off or expired proves nothing any more.
 */
export function canProveSecondFactor(state: MfaEnrollmentState): boolean {
  return state.state === "ENABLED";
}

/**
 * The fold. Never refuses — what may happen is the guards' question, and a
 * reducer that second-guessed the log could not replay it. Every branch
 * returns a new object so a caller cannot mutate history.
 */
export function reduceMfaEnrollment({
  state,
  fact,
}: {
  state: MfaEnrollmentState;
  fact: MfaFact;
}): MfaEnrollmentState {
  switch (fact.type) {
    case MFA_ENROLLED_EVENT_TYPE:
      // A fresh setup starts from nothing, whatever came before it: the
      // expired or disabled one stays in the history, and none of its
      // counters follow the new secret across.
      return {
        ...emptyMfaEnrollment({ userId: fact.data.userId }),
        enrollmentId: fact.data.enrollmentId,
        method: fact.data.method,
        state: "PENDING",
        enrolledAtMs: fact.occurredAt,
      };

    case MFA_CONFIRMED_EVENT_TYPE:
      return {
        ...state,
        state: "ENABLED",
        confirmedAtMs: fact.occurredAt,
        backupCodeCount: fact.data.backupCodeCount,
        consumedBackupCodeIndexes: [],
        failedCount: 0,
      };

    case MFA_ENROLLMENT_EXPIRED_EVENT_TYPE:
      return { ...state, state: "EXPIRED", expiredAtMs: fact.occurredAt };

    case MFA_DISABLED_EVENT_TYPE:
      return {
        ...state,
        state: "DISABLED",
        disabledAtMs: fact.occurredAt,
        disabledVia: fact.data.via,
        failedCount: 0,
      };

    case BACKUP_CODE_CONSUMED_EVENT_TYPE: {
      const { codeIndex } = fact.data;
      if (state.consumedBackupCodeIndexes.includes(codeIndex)) return state;
      return {
        ...state,
        consumedBackupCodeIndexes: [
          ...state.consumedBackupCodeIndexes,
          codeIndex,
        ].sort((a, b) => a - b),
        failedCount: 0,
      };
    }

    case BACKUP_CODES_REGENERATED_EVENT_TYPE:
      return {
        ...state,
        backupCodeCount: fact.data.backupCodeCount,
        consumedBackupCodeIndexes: [],
      };

    case MFA_VERIFICATION_FAILED_EVENT_TYPE:
      return { ...state, failedCount: fact.data.failedCount };
  }
}

// ---- commands ------------------------------------------------------------

export const ENROLL_MFA_COMMAND_TYPE = "lw.identity.enroll_mfa" as const;
export const CONFIRM_MFA_COMMAND_TYPE = "lw.identity.confirm_mfa" as const;
export const EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE =
  "lw.identity.expire_mfa_enrollment" as const;
export const DISABLE_MFA_COMMAND_TYPE = "lw.identity.disable_mfa" as const;
export const CONSUME_BACKUP_CODE_COMMAND_TYPE =
  "lw.identity.consume_backup_code" as const;
export const REGENERATE_BACKUP_CODES_COMMAND_TYPE =
  "lw.identity.regenerate_backup_codes" as const;
export const RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE =
  "lw.identity.record_mfa_verification_failure" as const;

export const MFA_COMMAND_TYPES = [
  ENROLL_MFA_COMMAND_TYPE,
  CONFIRM_MFA_COMMAND_TYPE,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  DISABLE_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
] as const;
export type MfaCommandType = (typeof MFA_COMMAND_TYPES)[number];

export const enrollMfaCommandDataSchema = userTenantedCommandSchema({
  enrollmentId: z.string().min(1),
  method: mfaMethodSchema,
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type EnrollMfaCommandData = z.infer<typeof enrollMfaCommandDataSchema>;

export const confirmMfaCommandDataSchema = userTenantedCommandSchema({
  enrollmentId: z.string().min(1),
  backupCodeCount: z.number().int().nonnegative(),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type ConfirmMfaCommandData = z.infer<typeof confirmMfaCommandDataSchema>;

export const expireMfaEnrollmentCommandDataSchema = userTenantedCommandSchema({
  enrollmentId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
});
export type ExpireMfaEnrollmentCommandData = z.infer<
  typeof expireMfaEnrollmentCommandDataSchema
>;

export const disableMfaCommandDataSchema = userTenantedCommandSchema({
  via: mfaDisableViaSchema,
  /**
   * Slugs of the organizations this person belongs to that require a second
   * factor, as the caller resolved them. Non-empty refuses the disable: the
   * guard names them back so the screen can say WHICH organization is
   * asking, and reads the requirement rather than trusting a boolean.
   */
  requiringOrganizationSlugs: z.array(z.string().min(1)),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type DisableMfaCommandData = z.infer<typeof disableMfaCommandDataSchema>;

export const consumeBackupCodeCommandDataSchema = userTenantedCommandSchema({
  codeIndex: z.number().int().nonnegative(),
  occurredAtMs: z.number().int().nonnegative(),
});
export type ConsumeBackupCodeCommandData = z.infer<
  typeof consumeBackupCodeCommandDataSchema
>;

export const regenerateBackupCodesCommandDataSchema = userTenantedCommandSchema(
  {
    backupCodeCount: z.number().int().positive(),
    occurredAtMs: z.number().int().nonnegative(),
    actor: identityActorSchema,
  },
);
export type RegenerateBackupCodesCommandData = z.infer<
  typeof regenerateBackupCodesCommandDataSchema
>;

export const recordMfaVerificationFailureCommandDataSchema =
  userTenantedCommandSchema({
    /** The plugin's own count after the attempt. */
    failedCount: z.number().int().nonnegative(),
    occurredAtMs: z.number().int().nonnegative(),
  });
export type RecordMfaVerificationFailureCommandData = z.infer<
  typeof recordMfaVerificationFailureCommandDataSchema
>;

export type MfaCommand =
  | { type: typeof ENROLL_MFA_COMMAND_TYPE; data: EnrollMfaCommandData }
  | { type: typeof CONFIRM_MFA_COMMAND_TYPE; data: ConfirmMfaCommandData }
  | {
      type: typeof EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE;
      data: ExpireMfaEnrollmentCommandData;
    }
  | { type: typeof DISABLE_MFA_COMMAND_TYPE; data: DisableMfaCommandData }
  | {
      type: typeof CONSUME_BACKUP_CODE_COMMAND_TYPE;
      data: ConsumeBackupCodeCommandData;
    }
  | {
      type: typeof REGENERATE_BACKUP_CODES_COMMAND_TYPE;
      data: RegenerateBackupCodesCommandData;
    }
  | {
      type: typeof RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE;
      data: RecordMfaVerificationFailureCommandData;
    };
