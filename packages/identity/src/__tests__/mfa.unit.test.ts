import { describe, expect, it } from "vitest";
import {
  IdentityMfaCodeInvalidError,
  IdentityMfaEnrollmentExpiredError,
} from "../errors";
import {
  BACKUP_CODE_CONSUMED_EVENT_TYPE,
  BACKUP_CODES_REGENERATED_EVENT_TYPE,
  backupCodeConsumedPayloadSchema,
  canProveSecondFactor,
  emptyMfaEnrollment,
  enrollMfaCommandDataSchema,
  MFA_CONFIRMED_EVENT_TYPE,
  MFA_DISABLED_EVENT_TYPE,
  MFA_ENROLLED_EVENT_TYPE,
  MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
  MFA_VERIFICATION_FAILED_EVENT_TYPE,
  type MfaEnrollmentState,
  type MfaFact,
  mfaConfirmedPayloadSchema,
  mfaEnrolledPayloadSchema,
  mfaVerificationFailedPayloadSchema,
  reduceMfaEnrollment,
  remainingBackupCodes,
} from "../mfa";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const ENROLLMENT = "mfaenr_01";
const T0 = 1_690_000_000_000;
const MINUTE = 60_000;

function enrolled(overrides?: {
  enrollmentId?: string;
  occurredAt?: number;
}): MfaFact {
  return {
    type: MFA_ENROLLED_EVENT_TYPE,
    occurredAt: overrides?.occurredAt ?? T0,
    data: {
      enrollmentId: overrides?.enrollmentId ?? ENROLLMENT,
      userId: USER,
      method: "totp",
      actor: ACTOR,
    },
  };
}

function confirmed(overrides?: {
  backupCodeCount?: number;
  occurredAt?: number;
}): MfaFact {
  return {
    type: MFA_CONFIRMED_EVENT_TYPE,
    occurredAt: overrides?.occurredAt ?? T0 + MINUTE,
    data: {
      enrollmentId: ENROLLMENT,
      backupCodeCount: overrides?.backupCodeCount ?? 10,
      actor: ACTOR,
    },
  };
}

function consumed(codeIndex: number, occurredAt = T0 + 2 * MINUTE): MfaFact {
  return {
    type: BACKUP_CODE_CONSUMED_EVENT_TYPE,
    occurredAt,
    data: { enrollmentId: ENROLLMENT, codeIndex },
  };
}

function failed(failedCount: number, occurredAt = T0 + 3 * MINUTE): MfaFact {
  return {
    type: MFA_VERIFICATION_FAILED_EVENT_TYPE,
    occurredAt,
    data: { enrollmentId: ENROLLMENT, failedCount },
  };
}

function fold(facts: MfaFact[]): MfaEnrollmentState {
  return facts.reduce(
    (state, fact) => reduceMfaEnrollment({ state, fact }),
    emptyMfaEnrollment({ userId: USER }),
  );
}

describe("the two-step verification aggregate", () => {
  describe("given a setup is being started", () => {
    /** @scenario "Starting a setup records the fact and never the secret" */
    it("keeps a shared secret out of the fact even when handed one", () => {
      const parsed = mfaEnrolledPayloadSchema.parse({
        enrollmentId: ENROLLMENT,
        userId: USER,
        method: "totp",
        actor: ACTOR,
        // What a careless caller might try to pass through from the plugin.
        secret: "JBSWY3DPEHPK3PXP",
        otpauthUrl: "otpauth://totp/LangWatch:sam?secret=JBSWY3DPEHPK3PXP",
      });

      expect(Object.keys(parsed).sort()).toEqual([
        "actor",
        "enrollmentId",
        "method",
        "userId",
      ]);
      expect(JSON.stringify(parsed)).not.toContain("JBSWY3DPEHPK3PXP");
    });

    /** @scenario "One person has one setup, however many organizations they belong to" */
    it("refuses a command whose tenant is not the person themselves", () => {
      const foreignTenant = enrollMfaCommandDataSchema.safeParse({
        tenantId: "organization_acme",
        userId: USER,
        commandId: "cmd_1",
        enrollmentId: ENROLLMENT,
        method: "totp",
        occurredAtMs: T0,
        actor: ACTOR,
      });

      expect(foreignTenant.success).toBe(false);

      const ownTenant = enrollMfaCommandDataSchema.safeParse({
        tenantId: USER,
        userId: USER,
        commandId: "cmd_1",
        enrollmentId: ENROLLMENT,
        method: "totp",
        occurredAtMs: T0,
        actor: ACTOR,
      });

      expect(ownTenant.success).toBe(true);
    });

    /** @scenario "Two setup attempts at once leave one setup" */
    it("collapses a second start onto one enrollment rather than accumulating", () => {
      const state = fold([
        enrolled({ enrollmentId: "mfaenr_first" }),
        enrolled({ enrollmentId: "mfaenr_second", occurredAt: T0 + 1 }),
      ]);

      expect(state.enrollmentId).toBe("mfaenr_second");
      expect(state.state).toBe("PENDING");
    });
  });

  describe("when a correct code arrives", () => {
    /** @scenario "A correct code finishes the setup" */
    it("moves the setup from pending to enabled", () => {
      const pending = fold([enrolled()]);
      expect(pending.state).toBe("PENDING");
      expect(canProveSecondFactor(pending)).toBe(false);

      const enabled = fold([enrolled(), confirmed()]);
      expect(enabled.state).toBe("ENABLED");
      expect(enabled.confirmedAtMs).toBe(T0 + MINUTE);
      expect(canProveSecondFactor(enabled)).toBe(true);
    });

    /** @scenario "A correct code before the limit clears the count" */
    it("resets the failure count when a backup code succeeds", () => {
      const state = fold([
        enrolled(),
        confirmed(),
        failed(1),
        failed(2),
        consumed(0, T0 + 4 * MINUTE),
      ]);

      expect(state.failedCount).toBe(0);
    });
  });

  describe("when a setup is left unfinished", () => {
    /** @scenario "A setup left unfinished expires on its own" */
    it("expires without anybody having to act", () => {
      const state = fold([
        enrolled(),
        {
          type: MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
          occurredAt: T0 + 24 * 60 * MINUTE,
          data: { enrollmentId: ENROLLMENT },
        },
      ]);

      expect(state.state).toBe("EXPIRED");
      expect(state.expiredAtMs).toBe(T0 + 24 * 60 * MINUTE);
      expect(canProveSecondFactor(state)).toBe(false);
    });
  });

  describe("given backup codes were issued", () => {
    /** @scenario "Backup codes are shown once and never given back" */
    it("records how many were issued and never what they were", () => {
      const parsed = mfaConfirmedPayloadSchema.parse({
        enrollmentId: ENROLLMENT,
        backupCodeCount: 10,
        actor: ACTOR,
        codes: ["11111111", "22222222"],
      });

      expect(Object.keys(parsed).sort()).toEqual([
        "actor",
        "backupCodeCount",
        "enrollmentId",
      ]);
      expect(JSON.stringify(parsed)).not.toContain("11111111");
      expect(fold([enrolled(), confirmed()]).backupCodeCount).toBe(10);
    });

    /** @scenario "A backup code works exactly once" */
    it("counts a repeated position once, however many times it arrives", () => {
      const once = fold([enrolled(), confirmed(), consumed(3)]);
      expect(remainingBackupCodes(once)).toBe(9);

      const twice = fold([
        enrolled(),
        confirmed(),
        consumed(3),
        consumed(3, T0 + 5 * MINUTE),
      ]);
      expect(twice.consumedBackupCodeIndexes).toEqual([3]);
      expect(remainingBackupCodes(twice)).toBe(9);
    });

    /** @scenario "Using a backup code is observable without exposing it" */
    it("states which position was spent and never the code", () => {
      const parsed = backupCodeConsumedPayloadSchema.parse({
        enrollmentId: ENROLLMENT,
        codeIndex: 4,
        code: "87654321",
      });

      expect(Object.keys(parsed).sort()).toEqual(["codeIndex", "enrollmentId"]);
      expect(JSON.stringify(parsed)).not.toContain("87654321");
    });

    /** @scenario "Regenerating replaces every code that was left" */
    it("drops the spent positions so the new set counts from full", () => {
      const state = fold([
        enrolled(),
        confirmed({ backupCodeCount: 10 }),
        consumed(0),
        consumed(1),
        {
          type: BACKUP_CODES_REGENERATED_EVENT_TYPE,
          occurredAt: T0 + 6 * MINUTE,
          data: {
            enrollmentId: ENROLLMENT,
            backupCodeCount: 10,
            actor: ACTOR,
          },
        },
      ]);

      expect(state.consumedBackupCodeIndexes).toEqual([]);
      expect(remainingBackupCodes(state)).toBe(10);
    });

    /** @scenario "Running out of backup codes is a named, actionable refusal" */
    it("reaches zero remaining once every position is spent", () => {
      const state = fold([
        enrolled(),
        confirmed({ backupCodeCount: 3 }),
        consumed(0),
        consumed(1),
        consumed(2),
      ]);

      expect(remainingBackupCodes(state)).toBe(0);
    });
  });

  describe("when a verification fails", () => {
    /** @scenario "Every failure is evidence, and none of it is the code" */
    it("records the count and drops whatever was typed", () => {
      const parsed = mfaVerificationFailedPayloadSchema.parse({
        enrollmentId: ENROLLMENT,
        failedCount: 2,
        attemptedCode: "000000",
      });

      expect(Object.keys(parsed).sort()).toEqual([
        "enrollmentId",
        "failedCount",
      ]);
      expect(JSON.stringify(parsed)).not.toContain("000000");
      expect(fold([enrolled(), confirmed(), failed(2)]).failedCount).toBe(2);
    });

    /** @scenario "A wrong code and a code for a setup nobody holds answer the same way" */
    it("answers a wrong code and an unknown enrollment identically", () => {
      const wrongCode = new IdentityMfaCodeInvalidError(
        `totp mismatch for ${USER}`,
      );
      const noSuchEnrollment = new IdentityMfaCodeInvalidError(
        `no enrollment for ${USER}`,
      );

      expect(noSuchEnrollment.code).toBe(wrongCode.code);
      expect(noSuchEnrollment.message).toBe(wrongCode.message);
      expect(noSuchEnrollment.httpStatus).toBe(wrongCode.httpStatus);

      // An expired setup IS separable — its remedy is to start again.
      expect(new IdentityMfaEnrollmentExpiredError("expired").code).not.toBe(
        wrongCode.code,
      );
    });
  });

  describe("when it is turned off", () => {
    /** @scenario "An administrator resets it for a member who lost their authenticator" */
    it("records that an administrator did it rather than the person", () => {
      const state = fold([
        enrolled(),
        confirmed(),
        {
          type: MFA_DISABLED_EVENT_TYPE,
          occurredAt: T0 + 7 * MINUTE,
          data: {
            enrollmentId: ENROLLMENT,
            via: "org-admin",
            actor: { type: "user", id: "user_admin" },
          },
        },
      ]);

      expect(state.state).toBe("DISABLED");
      expect(state.disabledVia).toBe("org-admin");
      expect(canProveSecondFactor(state)).toBe(false);
    });

    /** @scenario "History survives being turned off" */
    it("rebuilds the same row from the log after it was disabled", () => {
      const history: MfaFact[] = [
        enrolled(),
        confirmed(),
        consumed(0),
        failed(1),
        {
          type: MFA_DISABLED_EVENT_TYPE,
          occurredAt: T0 + 8 * MINUTE,
          data: {
            enrollmentId: ENROLLMENT,
            via: "password+totp",
            actor: ACTOR,
          },
        },
      ];

      const live = fold(history);
      const rebuilt = fold([...history]);

      expect(rebuilt).toEqual(live);
      expect(rebuilt.enrolledAtMs).toBe(T0);
      expect(rebuilt.confirmedAtMs).toBe(T0 + MINUTE);
      expect(rebuilt.disabledAtMs).toBe(T0 + 8 * MINUTE);

      // The rebuilt row is lifecycle only: no field of it could hold a
      // secret or a code, which is the point rather than an accident.
      expect(Object.keys(rebuilt).sort()).toEqual([
        "backupCodeCount",
        "confirmedAtMs",
        "consumedBackupCodeIndexes",
        "disabledAtMs",
        "disabledVia",
        "enrolledAtMs",
        "enrollmentId",
        "expiredAtMs",
        "failedCount",
        "method",
        "state",
        "userId",
      ]);
    });

    it("stops satisfying anything the moment it is off", () => {
      const enabled = fold([enrolled(), confirmed()]);
      expect(canProveSecondFactor(enabled)).toBe(true);

      const disabled = reduceMfaEnrollment({
        state: enabled,
        fact: {
          type: MFA_DISABLED_EVENT_TYPE,
          occurredAt: T0 + 9 * MINUTE,
          data: {
            enrollmentId: ENROLLMENT,
            via: "password+totp",
            actor: ACTOR,
          },
        },
      });
      expect(canProveSecondFactor(disabled)).toBe(false);
    });
  });

  describe("given a fresh setup after an old one ended", () => {
    it("starts a new setup from nothing rather than inheriting the old counters", () => {
      const state = fold([
        enrolled(),
        confirmed({ backupCodeCount: 10 }),
        consumed(0),
        failed(2),
        {
          type: MFA_DISABLED_EVENT_TYPE,
          occurredAt: T0 + 10 * MINUTE,
          data: {
            enrollmentId: ENROLLMENT,
            via: "org-admin",
            actor: { type: "user", id: "user_admin" },
          },
        },
        enrolled({ enrollmentId: "mfaenr_new", occurredAt: T0 + 11 * MINUTE }),
      ]);

      expect(state.state).toBe("PENDING");
      expect(state.consumedBackupCodeIndexes).toEqual([]);
      expect(state.backupCodeCount).toBe(0);
      expect(state.failedCount).toBe(0);
      expect(state.confirmedAtMs).toBeNull();
      // Not yet ENABLED, so nothing about it can satisfy a requirement.
      expect(canProveSecondFactor(state)).toBe(false);
    });
  });
});
