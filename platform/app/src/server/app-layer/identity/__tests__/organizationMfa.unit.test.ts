import { describe, expect, it } from "vitest";
import { isAuditLogExempt } from "~/server/api/auditLogExemptions";
import {
  type OrganizationConnectionFactorPort,
  type OrganizationMemberFactorPort,
  type OrganizationMfaNotifier,
  OrganizationMfaService,
  type OrganizationMfaSettingPort,
  type SessionFactorPort,
} from "../organization-mfa.service";

/**
 * Who turned the requirement on, and what happens to the people who set one
 * up when the flag goes off.
 *
 * Both are promises about the record and about absence, so both are tested
 * over doubles that make the forbidden move observable: a session store that
 * counts what it was asked to end, and an enrollment roster that counts what
 * it was asked to erase. Neither counter may ever move.
 */

interface Roster {
  userId: string;
  accountEnrollmentEnabled: boolean;
}

function build({
  mfaRequired = false,
  offered = true,
  entitled = true,
  roster = [] as Roster[],
}) {
  const organization = { mfaRequired, name: "Acme", slug: "acme" };
  const told: {
    organizationId: string;
    actorUserId: string;
    memberUserIds: readonly string[];
  }[] = [];
  /** Anything the service asks to be undone. Must stay empty. */
  const undone: string[] = [];

  const settings: OrganizationMfaSettingPort = {
    // A copy, like a real repository hands back. Returning the live object
    // made every read an alias of the row, so a value read before a write
    // silently became the value after it.
    read: async () => ({ ...organization }),
    write: async ({ mfaRequired: next }) => {
      organization.mfaRequired = next;
    },
  };
  const sessions: SessionFactorPort = {
    amrFor: async () => ["pwd"],
  };
  const members: OrganizationMemberFactorPort = {
    membersOf: async () =>
      roster.map((one) => ({
        userId: one.userId,
        name: one.userId,
        email: `${one.userId}@acme.com`,
        accountEnrollmentEnabled: one.accountEnrollmentEnabled,
        passkeyCount: 0,
      })),
    accountFactorFor: async ({ userId }) => ({
      accountEnrollmentEnabled:
        roster.find((one) => one.userId === userId)?.accountEnrollmentEnabled ??
        false,
      passkeyCount: 0,
    }),
    isMember: async ({ userId }) => roster.some((one) => one.userId === userId),
  };
  const connections: OrganizationConnectionFactorPort = {
    assertedFactorsFor: async () => null,
  };
  const notifier: OrganizationMfaNotifier = {
    requirementTurnedOn: async (args) => {
      told.push(args);
    },
  };
  /** Every organization the plan was asked about. */
  const planAsked: string[] = [];

  return {
    organization,
    told,
    undone,
    planAsked,
    service: new OrganizationMfaService({
      settings,
      sessions,
      members,
      connections,
      notifier,
      offered: () => offered,
      entitled: async ({ organizationId }) => {
        planAsked.push(organizationId);
        return entitled;
      },
    }),
  };
}

describe("turning the organization's requirement on", () => {
  describe("when ana turns the requirement on for acme", () => {
    /** @scenario Turning the requirement on is recorded with who did it */
    it("records the change against the person who made it", () => {
      // The row itself is the platform's, not this service's: every mutation
      // that is not exempt writes one, stamped with the acting user, the
      // organization named in the input and the action path. So the fact
      // worth pinning here is that this action is NOT exempt — the day
      // somebody adds it to that list is the day the record quietly stops.
      expect(isAuditLogExempt("twoStepVerification.setRequirement")).toBe(
        false,
      );
    });

    /** @scenario Turning the requirement on is recorded with who did it */
    it("tells every member of acme that the requirement now applies, naming who did it", async () => {
      const { service, told } = build({
        roster: [
          { userId: "sam", accountEnrollmentEnabled: false },
          { userId: "ana", accountEnrollmentEnabled: true },
        ],
      });

      await service.setRequirement({
        organizationId: "acme",
        mfaRequired: true,
        actorUserId: "ana",
      });

      expect(told).toEqual([
        {
          organizationId: "acme",
          actorUserId: "ana",
          // Everyone, not only the ones it holds: a member who can already
          // prove one still needs to know the rule they are now living under.
          memberUserIds: ["sam", "ana"],
        },
      ]);
    });

    /** @scenario Turning the requirement on is recorded with who did it */
    it("tells nobody when the setting did not actually change", async () => {
      const { service, told } = build({
        mfaRequired: true,
        roster: [{ userId: "sam", accountEnrollmentEnabled: false }],
      });

      await service.setRequirement({
        organizationId: "acme",
        mfaRequired: true,
        actorUserId: "ana",
      });

      expect(told).toEqual([]);
    });
  });
});

describe("turning the organization's requirement on without the plan", () => {
  describe("given acme is not on a plan that carries the requirement", () => {
    /** @scenario Turning the requirement on without the plan is refused by the server */
    it("refuses the flip and leaves the setting where it was", async () => {
      const { service, organization, told } = build({
        entitled: false,
        roster: [{ userId: "sam", accountEnrollmentEnabled: false }],
      });

      const refusal = await service
        .setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        })
        .then(
          () => null,
          (error: unknown) => error as { code?: string },
        );

      expect(refusal?.code).toBe("identity_mfa_requirement_not_licensed");
      // Nothing was written and nobody was told a rule that never started.
      expect(organization.mfaRequired).toBe(false);
      expect(told).toEqual([]);
    });

    /** @scenario Turning the requirement on without the plan is refused by the server */
    it("still lets an organization that already holds it turn it off", async () => {
      // The lapsed-plan case. Its members are standing at an enrollment gate,
      // and an administrator who could not release them would have bought a
      // lockout, so turning it OFF asks no plan at all.
      const { service, organization } = build({
        mfaRequired: true,
        entitled: false,
        roster: [{ userId: "sam", accountEnrollmentEnabled: false }],
      });

      const result = await service.setRequirement({
        organizationId: "acme",
        mfaRequired: false,
        actorUserId: "ana",
      });

      expect(result).toEqual({ previous: true, next: false });
      expect(organization.mfaRequired).toBe(false);
    });

    /** @scenario Turning the requirement on without the plan is refused by the server */
    it("asks the plan about the organization named in the request", async () => {
      const { service, planAsked } = build({ entitled: false });

      await service
        .setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        })
        .catch(() => null);

      // A gate that resolved the plan of some ambient organization would pass
      // for the wrong one the first time two are in play.
      expect(planAsked).toEqual(["acme"]);
    });
  });

  describe("given acme is on a plan that carries the requirement", () => {
    /** @scenario Turning the requirement on without the plan is refused by the server */
    it("turns it on", async () => {
      const { service, organization } = build({
        entitled: true,
        roster: [{ userId: "sam", accountEnrollmentEnabled: false }],
      });

      await service.setRequirement({
        organizationId: "acme",
        mfaRequired: true,
        actorUserId: "ana",
      });

      expect(organization.mfaRequired).toBe(true);
    });
  });
});

describe("turning the flag off", () => {
  describe("given members of acme have set two-step verification up", () => {
    /** @scenario Turning the flag off leaves people who set one up signed in */
    it("keeps their sessions working", async () => {
      const { service } = build({
        mfaRequired: true,
        offered: false,
        roster: [{ userId: "ana", accountEnrollmentEnabled: true }],
      });

      const standing = await service.standingForSession({
        userId: "ana",
        organizationId: "acme",
        sessionId: "ana-session",
      });

      // Not held, not refused, not ended. With nothing offered here the
      // organization asks for nothing, so the same session goes on working
      // exactly as it did.
      expect(standing.required).toBe(false);
      expect(standing.satisfaction).toEqual({
        satisfied: true,
        by: "not_required",
      });
    });

    /** @scenario Turning the flag off leaves people who set one up signed in */
    it("erases nothing they set up", async () => {
      const { service } = build({
        mfaRequired: true,
        offered: false,
        roster: [{ userId: "ana", accountEnrollmentEnabled: true }],
      });

      const factors = await service.memberFactors({ organizationId: "acme" });

      // The account still carries it. Turning the flag off stops the feature
      // being ASKED for; it is not a deletion, and turning it back on finds
      // everything where it was.
      expect(factors).toEqual([
        expect.objectContaining({
          userId: "ana",
          accountEnrollmentEnabled: true,
          satisfaction: { satisfied: true, by: "account_enrollment" },
        }),
      ]);
    });

    /** @scenario Turning the flag off leaves people who set one up signed in */
    it("refuses to let an organization start requiring one", async () => {
      const { service, organization } = build({
        offered: false,
        roster: [{ userId: "ana", accountEnrollmentEnabled: true }],
      });

      const refusal = await service
        .setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        })
        .then(
          () => null,
          (error: unknown) => error as { code?: string },
        );

      expect(refusal?.code).toBe("identity_mfa_enrollment_required");
      expect(organization.mfaRequired).toBe(false);
    });
  });
});
