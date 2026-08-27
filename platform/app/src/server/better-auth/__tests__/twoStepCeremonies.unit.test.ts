import type { MfaEnrollmentState } from "@langwatch/identity";
import { MfaCeremonies } from "@langwatch/identity-server/better-auth";
import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two-factor endpoints, as identity facts (D06 follow-up 1).
 *
 * Before this, the `MfaEnrollment` aggregate had a pipeline, guards, commands
 * and a projection and no writer at all: better-auth's `databaseHooks` do not
 * fire for a plugin's own tables, so every `TwoFactor` row appeared without a
 * single event. The endpoint hook is the writer, and what is under test here
 * is what it states, what it declines to state, and — the invariant that
 * outranks the rest — that nothing it states can carry a secret or a code.
 */

const mfaCeremoniesMock = vi.fn();
vi.mock("~/server/app-layer/identity/runtime", () => ({
  mfaCeremonies: () => mfaCeremoniesMock(),
}));

import {
  ceremonyVerbFor,
  runTwoStepCeremony,
  userIdIn,
} from "../two-step-ceremonies";

const enrollment = (
  overrides: Partial<MfaEnrollmentState> = {},
): MfaEnrollmentState => ({
  userId: "sam",
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
  ...overrides,
});

const ceremoniesOver = (state: MfaEnrollmentState) => {
  // Each takes its command, declared rather than inferred: `async () => []`
  // types the arguments as an EMPTY tuple, so the scenarios below that read
  // `mock.calls[0]` were indexing a tuple the type said had no element there.
  const mfa = {
    enrollMfa: vi.fn(async (_command: unknown) => []),
    confirmMfa: vi.fn(async (_command: unknown) => []),
    consumeBackupCode: vi.fn(async (_command: unknown) => []),
    regenerateBackupCodes: vi.fn(async (_command: unknown) => []),
    disableMfa: vi.fn(async (_command: unknown) => []),
    expireMfaEnrollment: vi.fn(async (_command: unknown) => []),
    recordVerificationFailure: vi.fn(async (_command: unknown) => []),
  };
  const ceremonies = new MfaCeremonies({
    mfa: mfa as never,
    enrollments: {
      findEnrollment: async () => state,
      findRequiringOrganizationSlugs: async () => [],
    },
    backupCodeCount: 10,
    now: () => 1_700_000_000_000,
  });
  mfaCeremoniesMock.mockReturnValue(ceremonies);
  return mfa;
};

const call = ({
  path,
  userId = "sam",
  returned,
}: {
  path: string;
  userId?: string | null;
  returned?: unknown;
}) => ({
  path,
  context: {
    returned,
    newSession: userId ? { user: { id: userId } } : null,
    session: null,
  },
});

describe("the two-factor endpoints as identity facts", () => {
  beforeEach(() => {
    mfaCeremoniesMock.mockReset();
  });

  describe("given a setup that has just been started", () => {
    describe("when the enable endpoint answers", () => {
      it("states an enrollment naming the method and nothing else", async () => {
        const mfa = ceremoniesOver(enrollment());

        await runTwoStepCeremony(call({ path: "/two-factor/enable" }));

        expect(mfa.enrollMfa).toHaveBeenCalledTimes(1);
        const [command] = mfa.enrollMfa.mock.calls[0]!;
        expect(command).toMatchObject({
          tenantId: "sam",
          userId: "sam",
          method: "totp",
        });
        // Nothing that could hold a secret. The command has no field for
        // one, and this is the assertion that keeps it that way.
        expect(JSON.stringify(command)).not.toMatch(/secret|totpURI|otpauth/i);
      });
    });
  });

  describe("given a PENDING setup", () => {
    describe("when a correct code is accepted", () => {
      it("confirms it, with the count of codes issued and no code", async () => {
        const mfa = ceremoniesOver(
          enrollment({ state: "PENDING", enrollmentId: "enr_1" }),
        );

        await runTwoStepCeremony(call({ path: "/two-factor/verify-totp" }));

        expect(mfa.confirmMfa).toHaveBeenCalledTimes(1);
        const [command] = mfa.confirmMfa.mock.calls[0]!;
        expect(command).toMatchObject({
          enrollmentId: "enr_1",
          backupCodeCount: 10,
        });
        expect(JSON.stringify(command)).not.toMatch(/code"\s*:\s*"/i);
      });
    });
  });

  describe("given an ENABLED enrollment", () => {
    describe("when an ordinary sign-in answers its challenge", () => {
      it("states nothing at all", async () => {
        const mfa = ceremoniesOver(
          enrollment({ state: "ENABLED", enrollmentId: "enr_1" }),
        );

        await runTwoStepCeremony(call({ path: "/two-factor/verify-totp" }));

        expect(mfa.confirmMfa).not.toHaveBeenCalled();
      });
    });

    describe("when a backup code is used", () => {
      it("records the position spent, never the code", async () => {
        const mfa = ceremoniesOver(
          enrollment({
            state: "ENABLED",
            enrollmentId: "enr_1",
            backupCodeCount: 10,
            consumedBackupCodeIndexes: [0, 1],
          }),
        );

        await runTwoStepCeremony(
          call({ path: "/two-factor/verify-backup-code" }),
        );

        expect(mfa.consumeBackupCode).toHaveBeenCalledTimes(1);
        const [command] = mfa.consumeBackupCode.mock.calls[0]!;
        expect(command).toMatchObject({ codeIndex: 2 });
      });
    });

    describe("when a fresh set of backup codes is generated", () => {
      it("states the new count, discarding what was left", async () => {
        const mfa = ceremoniesOver(
          enrollment({ state: "ENABLED", enrollmentId: "enr_1" }),
        );

        await runTwoStepCeremony(
          call({ path: "/two-factor/generate-backup-codes" }),
        );

        expect(mfa.regenerateBackupCodes).toHaveBeenCalledWith(
          expect.objectContaining({ backupCodeCount: 10, userId: "sam" }),
        );
      });
    });

    describe("when it is turned off", () => {
      it("states who did it and how", async () => {
        const mfa = ceremoniesOver(
          enrollment({ state: "ENABLED", enrollmentId: "enr_1" }),
        );

        await runTwoStepCeremony(call({ path: "/two-factor/disable" }));

        expect(mfa.disableMfa).toHaveBeenCalledWith(
          expect.objectContaining({
            via: "password+totp",
            actor: { type: "user", id: "sam" },
          }),
        );
      });
    });
  });

  describe("given a call that was refused", () => {
    it("states nothing, so a wrong code is never recorded as a setup", async () => {
      const mfa = ceremoniesOver(enrollment());

      await runTwoStepCeremony(
        call({
          path: "/two-factor/verify-totp",
          returned: new APIError("UNAUTHORIZED", { code: "INVALID_CODE" }),
        }),
      );

      expect(mfa.confirmMfa).not.toHaveBeenCalled();
      expect(mfa.enrollMfa).not.toHaveBeenCalled();
    });
  });

  describe("given a call we cannot attribute to a person", () => {
    it("states nothing rather than guessing whose it was", async () => {
      const mfa = ceremoniesOver(enrollment());

      await runTwoStepCeremony(
        call({ path: "/two-factor/enable", userId: null }),
      );

      expect(mfa.enrollMfa).not.toHaveBeenCalled();
    });
  });

  describe("given a ceremony that cannot state its fact", () => {
    it("lets the endpoint's own success stand", async () => {
      const mfa = ceremoniesOver(enrollment());
      mfa.enrollMfa.mockRejectedValue(new Error("the event stack is down"));

      await expect(
        runTwoStepCeremony(call({ path: "/two-factor/enable" })),
      ).resolves.toBeUndefined();
    });
  });

  describe("the endpoints this hook answers for", () => {
    it("names the five that state a fact", () => {
      expect(ceremonyVerbFor({ path: "/two-factor/enable" })).toBe("enable");
      expect(ceremonyVerbFor({ path: "/two-factor/verify-totp" })).toBe(
        "verify-totp",
      );
      expect(ceremonyVerbFor({ path: "/two-factor/verify-backup-code" })).toBe(
        "verify-backup-code",
      );
      expect(
        ceremonyVerbFor({ path: "/two-factor/generate-backup-codes" }),
      ).toBe("generate-backup-codes");
      expect(ceremonyVerbFor({ path: "/two-factor/disable" })).toBe("disable");
    });

    it("answers for no other path", () => {
      expect(ceremonyVerbFor({ path: "/sign-in/email" })).toBeNull();
      expect(ceremonyVerbFor({ path: "/two-factor/get-totp-uri" })).toBeNull();
      expect(ceremonyVerbFor({ path: undefined })).toBeNull();
    });
  });

  describe("whose account a call was", () => {
    it("prefers the session the call just minted", () => {
      expect(
        userIdIn({
          context: {
            newSession: { user: { id: "fresh" } },
            session: { user: { id: "existing" } },
          },
        }),
      ).toBe("fresh");
    });

    it("falls back to the caller's own session", () => {
      expect(
        userIdIn({
          context: { newSession: null, session: { user: { id: "existing" } } },
        }),
      ).toBe("existing");
    });

    it("answers nothing when neither is there", () => {
      expect(userIdIn({ context: {} })).toBeNull();
    });
  });
});
