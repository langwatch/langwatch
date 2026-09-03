import {
  emptyMfaEnrollment,
  type MfaEnrollmentState,
  type MfaFact,
  type MfaFactInput,
  reduceMfaEnrollment,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import { MfaGuards } from "../mfa-guards";
import type { MfaEnrollmentRepository } from "../mfa-enrollment.repository";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const ADMIN_ACTOR = { type: "user" as const, id: "user_admin" };
const ENROLLMENT = "mfaenr_01";
const T0 = 1_690_000_000_000;

/**
 * The projection the guards read, folded from facts the way the real one is,
 * so a guard's refusal is tested against state that a real event log could
 * actually have produced.
 */
class InMemoryEnrollments implements MfaEnrollmentRepository {
  state: MfaEnrollmentState = emptyMfaEnrollment({ userId: USER });
  requiring: readonly string[] = [];

  async findEnrollment(): Promise<MfaEnrollmentState> {
    return this.state;
  }

  async findRequiringOrganizationSlugs(): Promise<readonly string[]> {
    return this.requiring;
  }

  fold(facts: MfaFactInput[], occurredAt = T0): void {
    this.state = facts.reduce(
      (state, fact) => reduceMfaEnrollment({ state, fact: { ...fact, occurredAt } as MfaFact }),
      this.state,
    );
  }
}

function enrollData(enrollmentId = ENROLLMENT) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "mfacmd_1",
    enrollmentId,
    method: "totp" as const,
    occurredAtMs: T0,
    actor: ACTOR,
  };
}

function confirmData(enrollmentId = ENROLLMENT, backupCodeCount = 10) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "mfacmd_2",
    enrollmentId,
    backupCodeCount,
    occurredAtMs: T0 + 60_000,
    actor: ACTOR,
  };
}

async function enabled(backupCodeCount = 10): Promise<{
  repo: InMemoryEnrollments;
  guards: MfaGuards;
}> {
  const repo = new InMemoryEnrollments();
  const guards = new MfaGuards(repo);
  repo.fold(await guards.enrollMfa(enrollData()));
  repo.fold(await guards.confirmMfa(confirmData(ENROLLMENT, backupCodeCount)));
  return { repo, guards };
}

describe("the two-step verification guards", () => {
  describe("given a setup is being started", () => {
    /** @scenario "Starting a setup records the fact and never the secret" */
    it("states the enrollment under the person's own tenancy", async () => {
      const repo = new InMemoryEnrollments();
      const facts = await new MfaGuards(repo).enrollMfa(enrollData());

      expect(facts).toEqual([
        {
          type: "lw.identity.mfa_enrolled",
          data: {
            enrollmentId: ENROLLMENT,
            userId: USER,
            method: "totp",
            actor: ACTOR,
          },
        },
      ]);
    });

    /** @scenario "Two setup attempts at once leave one setup" */
    it("refuses the second attempt rather than replacing the first", async () => {
      const repo = new InMemoryEnrollments();
      const guards = new MfaGuards(repo);
      repo.fold(await guards.enrollMfa(enrollData("mfaenr_first")));

      // Replacing it would invalidate a secret the person may already have
      // scanned, so the loser is refused and the first setup stands.
      await expect(
        guards.enrollMfa({ ...enrollData("mfaenr_second"), commandId: "c2" }),
      ).rejects.toMatchObject({ code: "identity_mfa_code_invalid" });
      expect(repo.state.enrollmentId).toBe("mfaenr_first");

      // The winner's own retry is not a second attempt; it states nothing.
      expect(await guards.enrollMfa(enrollData("mfaenr_first"))).toEqual([]);
    });
  });

  describe("when a setup is confirmed", () => {
    /** @scenario "A correct code finishes the setup" */
    it("states the confirmation with the number of codes issued", async () => {
      const repo = new InMemoryEnrollments();
      const guards = new MfaGuards(repo);
      repo.fold(await guards.enrollMfa(enrollData()));

      expect(await guards.confirmMfa(confirmData())).toEqual([
        {
          type: "lw.identity.mfa_confirmed",
          data: { enrollmentId: ENROLLMENT, backupCodeCount: 10, actor: ACTOR },
        },
      ]);
    });

    /** @scenario "Entering a code for an expired setup says so and offers the way forward" */
    it("separates an expired setup from a wrong code", async () => {
      const repo = new InMemoryEnrollments();
      const guards = new MfaGuards(repo);
      repo.fold(await guards.enrollMfa(enrollData()));
      repo.fold(
        await guards.expireMfaEnrollment({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_x",
          enrollmentId: ENROLLMENT,
          occurredAtMs: T0 + 24 * 3_600_000,
        }),
        T0 + 24 * 3_600_000,
      );

      await expect(guards.confirmMfa(confirmData())).rejects.toMatchObject({
        code: "identity_mfa_enrollment_expired",
      });
    });

    it("states nothing when the setup was already confirmed", async () => {
      const { guards } = await enabled();
      expect(await guards.confirmMfa(confirmData())).toEqual([]);
    });
  });

  describe("when an unfinished setup reaches its deadline", () => {
    /** @scenario "A setup left unfinished expires on its own" */
    it("expires a pending setup and leaves a finished one alone", async () => {
      const repo = new InMemoryEnrollments();
      const guards = new MfaGuards(repo);
      repo.fold(await guards.enrollMfa(enrollData()));

      const expire = {
        tenantId: USER,
        userId: USER,
        commandId: "mfacmd_x",
        enrollmentId: ENROLLMENT,
        occurredAtMs: T0 + 24 * 3_600_000,
      };
      expect(await guards.expireMfaEnrollment(expire)).toEqual([
        {
          type: "lw.identity.mfa_enrollment_expired",
          data: { enrollmentId: ENROLLMENT },
        },
      ]);

      // Somebody who finished in the meantime must not be expired out from
      // under a working enrollment.
      repo.fold(await guards.confirmMfa(confirmData()));
      expect(await guards.expireMfaEnrollment(expire)).toEqual([]);
    });
  });

  describe("when it is turned off", () => {
    /** @scenario "Turning it off takes the password and a current code" */
    it("records how the person proved themselves", async () => {
      const { guards } = await enabled();

      expect(
        await guards.disableMfa({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_3",
          via: "password+totp",
          requiringOrganizationSlugs: [],
          occurredAtMs: T0 + 120_000,
          actor: ACTOR,
        }),
      ).toEqual([
        {
          type: "lw.identity.mfa_disabled",
          data: {
            enrollmentId: ENROLLMENT,
            via: "password+totp",
            actor: ACTOR,
          },
        },
      ]);
    });

    /** @scenario "An administrator resets it for a member who lost their authenticator" */
    it("records an administrator's reset as theirs, not the person's", async () => {
      const { guards } = await enabled();

      const facts = await guards.disableMfa({
        tenantId: USER,
        userId: USER,
        commandId: "mfacmd_4",
        via: "org-admin",
        requiringOrganizationSlugs: [],
        occurredAtMs: T0 + 120_000,
        actor: ADMIN_ACTOR,
      });

      expect(facts[0]).toMatchObject({
        data: { via: "org-admin", actor: ADMIN_ACTOR },
      });
    });

    /** @scenario "Turning it off is refused while an organization requires it" */
    it("refuses and names the organizations that are asking", async () => {
      const { repo, guards } = await enabled();
      repo.requiring = ["acme", "globex"];

      const attempt = guards.disableMfa({
        tenantId: USER,
        userId: USER,
        commandId: "mfacmd_5",
        via: "password+totp",
        requiringOrganizationSlugs: [],
        occurredAtMs: T0 + 120_000,
        actor: ACTOR,
      });

      await expect(attempt).rejects.toMatchObject({
        code: "identity_mfa_required_by_organization",
      });
      // The requirement is read here rather than trusted from the command,
      // so a caller working from a stale membership list cannot slip past.
      await expect(attempt).rejects.toMatchObject({
        message: "identity_mfa_required_by_organization",
      });
    });

    it("refuses an administrator's reset too while an organization requires it", async () => {
      const { repo, guards } = await enabled();
      repo.requiring = ["acme"];

      await expect(
        guards.disableMfa({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_6",
          via: "org-admin",
          requiringOrganizationSlugs: [],
          occurredAtMs: T0 + 120_000,
          actor: ADMIN_ACTOR,
        }),
      ).rejects.toMatchObject({
        code: "identity_mfa_required_by_organization",
      });
    });
  });

  describe("given backup codes were issued", () => {
    /** @scenario "A backup code works exactly once" */
    it("refuses a position that was already spent", async () => {
      const { repo, guards } = await enabled();
      const spend = {
        tenantId: USER,
        userId: USER,
        commandId: "mfacmd_7",
        codeIndex: 2,
        occurredAtMs: T0 + 180_000,
      };

      repo.fold(await guards.consumeBackupCode(spend));

      await expect(guards.consumeBackupCode(spend)).rejects.toMatchObject({
        code: "identity_mfa_code_invalid",
      });
    });

    /** @scenario "Running out of backup codes is a named, actionable refusal" */
    it("names exhaustion rather than answering like a wrong code", async () => {
      const { repo, guards } = await enabled(2);

      for (const codeIndex of [0, 1]) {
        repo.fold(
          await guards.consumeBackupCode({
            tenantId: USER,
            userId: USER,
            commandId: `mfacmd_spend_${codeIndex}`,
            codeIndex,
            occurredAtMs: T0 + 180_000,
          }),
        );
      }

      await expect(
        guards.consumeBackupCode({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_spend_2",
          codeIndex: 2,
          occurredAtMs: T0 + 240_000,
        }),
      ).rejects.toMatchObject({
        code: "identity_mfa_backup_codes_exhausted",
      });
    });

    /** @scenario "Regenerating replaces every code that was left" */
    it("states a fresh set that counts from full again", async () => {
      const { repo, guards } = await enabled();
      repo.fold(
        await guards.consumeBackupCode({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_8",
          codeIndex: 0,
          occurredAtMs: T0 + 180_000,
        }),
      );

      repo.fold(
        await guards.regenerateBackupCodes({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_9",
          backupCodeCount: 10,
          occurredAtMs: T0 + 240_000,
          actor: ACTOR,
        }),
      );

      expect(repo.state.consumedBackupCodeIndexes).toEqual([]);
      expect(repo.state.backupCodeCount).toBe(10);
    });
  });

  describe("when a verification fails", () => {
    /** @scenario "Repeated wrong codes stop the factor answering for a while" */
    it("records the plugin's running count as evidence", async () => {
      const { guards } = await enabled();

      expect(
        await guards.recordVerificationFailure({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_10",
          failedCount: 3,
          occurredAtMs: T0 + 300_000,
        }),
      ).toEqual([
        {
          type: "lw.identity.mfa_verification_failed",
          data: { enrollmentId: ENROLLMENT, failedCount: 3 },
        },
      ]);
    });

    /** @scenario "The lockout follows the person, not the browser" */
    it("attaches the failure to the person's enrollment and nothing else", async () => {
      const { guards } = await enabled();

      // Nothing in the command or the fact names a browser, a device or a
      // session: the count lives on the person's enrollment, so opening a
      // private window reaches the same locked-out account.
      const [fact] = await guards.recordVerificationFailure({
        tenantId: USER,
        userId: USER,
        commandId: "mfacmd_11",
        failedCount: 5,
        occurredAtMs: T0 + 360_000,
      });

      expect(Object.keys(fact!.data).sort()).toEqual(["enrollmentId", "failedCount"]);
    });

    it("writes nothing for somebody who never set one up", async () => {
      const repo = new InMemoryEnrollments();

      // Probing for another person's account must not leave rows behind.
      expect(
        await new MfaGuards(repo).recordVerificationFailure({
          tenantId: USER,
          userId: USER,
          commandId: "mfacmd_12",
          failedCount: 1,
          occurredAtMs: T0,
        }),
      ).toEqual([]);
    });
  });
});
