/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readHandledError } from "~/features/errors";
import {
  type OrganizationConnectionFactorPort,
  type OrganizationMemberFactorPort,
  type OrganizationMfaNotifier,
  OrganizationMfaService,
  type OrganizationMfaSettingPort,
  type SessionFactorPort,
} from "../organization-mfa.service";

/**
 * The organization's membership condition, exercised across its ports.
 *
 * jsdom and no datastore, so it runs in the component lane: every port here
 * is an in-memory double, and what is being tested is the SERVICE and the
 * decisions it makes over them. A database would only slow down the same
 * assertions.
 *
 * The session double is the load-bearing one. It records every read AND
 * offers a `revoke` nobody may call — a spy on an absence, because "turning
 * the requirement on ends no session" is a promise about what does not
 * happen, and the only way to test that is to make the forbidden thing
 * observable.
 */

interface Member {
  userId: string;
  name: string | null;
  email: string | null;
  accountEnrollmentEnabled: boolean;
  passkeyCount: number;
}

class Sessions implements SessionFactorPort {
  readonly held = new Map<string, { userId: string; amr: string[] }>();
  /** Sessions this test run has ended. Must stay empty, always. */
  readonly ended: string[] = [];

  hold({
    sessionId,
    userId,
    amr,
  }: {
    sessionId: string;
    userId: string;
    amr: string[];
  }) {
    this.held.set(sessionId, { userId, amr });
  }

  async amrFor({
    sessionId,
  }: {
    sessionId: string;
  }): Promise<readonly string[] | null> {
    return this.held.get(sessionId)?.amr ?? null;
  }

  /** Nothing in the service may reach this; it exists so it can be watched. */
  end(sessionId: string) {
    this.ended.push(sessionId);
    this.held.delete(sessionId);
  }
}

function serviceFor({
  organizations,
  members,
  sessions,
  connections = {},
  offered = true,
  entitled = true,
}: {
  organizations: Record<
    string,
    { mfaRequired: boolean; name: string; slug: string }
  >;
  members: Record<string, Member[]>;
  sessions: Sessions;
  connections?: Record<string, readonly string[] | null>;
  offered?: boolean;
  entitled?: boolean;
}) {
  const told: {
    organizationId: string;
    actorUserId: string;
    memberUserIds: readonly string[];
  }[] = [];

  const settings: OrganizationMfaSettingPort = {
    read: async ({ organizationId }) => {
      const organization = organizations[organizationId];
      if (!organization) throw new Error(`no organization ${organizationId}`);
      return organization;
    },
    write: async ({ organizationId, mfaRequired }) => {
      const organization = organizations[organizationId];
      if (!organization) throw new Error(`no organization ${organizationId}`);
      organization.mfaRequired = mfaRequired;
    },
  };

  const memberPort: OrganizationMemberFactorPort = {
    membersOf: async ({ organizationId }) => members[organizationId] ?? [],
    accountFactorFor: async ({ userId }) => {
      for (const roster of Object.values(members)) {
        const found = roster.find((member) => member.userId === userId);
        if (found) {
          return {
            accountEnrollmentEnabled: found.accountEnrollmentEnabled,
            passkeyCount: found.passkeyCount,
          };
        }
      }
      return { accountEnrollmentEnabled: false, passkeyCount: 0 };
    },
    isMember: async ({ userId, organizationId }) =>
      (members[organizationId] ?? []).some(
        (member) => member.userId === userId,
      ),
  };

  const connectionPort: OrganizationConnectionFactorPort = {
    assertedFactorsFor: async ({ organizationId }) =>
      connections[organizationId] ?? null,
  };

  const notifier: OrganizationMfaNotifier = {
    requirementTurnedOn: async (args) => {
      told.push(args);
    },
  };

  return {
    told,
    service: new OrganizationMfaService({
      settings,
      sessions,
      members: memberPort,
      connections: connectionPort,
      notifier,
      offered: () => offered,
      entitled: async () => entitled,
    }),
  };
}

describe("the organization's second-factor requirement", () => {
  let sessions: Sessions;

  beforeEach(() => {
    sessions = new Sessions();
  });

  describe("given acme's members hold sessions, some of them minted without a second factor", () => {
    describe("when ana turns the requirement on for acme", () => {
      /** @scenario Turning the requirement on ends no session */
      it("ends not one session", async () => {
        sessions.hold({
          sessionId: "sam-session",
          userId: "sam",
          amr: ["pwd"],
        });
        sessions.hold({
          sessionId: "ana-session",
          userId: "ana",
          amr: ["pwd", "otp"],
        });
        const { service } = serviceFor({
          organizations: {
            acme: { mfaRequired: false, name: "Acme", slug: "acme" },
          },
          members: {
            acme: [
              member({ userId: "sam" }),
              member({ userId: "ana", accountEnrollmentEnabled: true }),
            ],
          },
          sessions,
        });

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        });

        expect(sessions.ended).toEqual([]);
        expect([...sessions.held.keys()]).toEqual([
          "sam-session",
          "ana-session",
        ]);
      });

      /** @scenario Turning the requirement on ends no session */
      it("leaves every member signed in to everything else they use", async () => {
        sessions.hold({
          sessionId: "sam-session",
          userId: "sam",
          amr: ["pwd"],
        });
        const { service } = serviceFor({
          organizations: {
            acme: { mfaRequired: false, name: "Acme", slug: "acme" },
            personal: {
              mfaRequired: false,
              name: "Sam's workspace",
              slug: "sam",
            },
          },
          members: {
            acme: [member({ userId: "sam" })],
            personal: [member({ userId: "sam" })],
          },
          sessions,
        });

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        });

        // The same session, reaching the organization that asked for nothing.
        const elsewhere = await service.standingForSession({
          userId: "sam",
          organizationId: "personal",
          sessionId: "sam-session",
        });
        expect(elsewhere.satisfaction.satisfied).toBe(true);
        expect(sessions.ended).toEqual([]);
      });
    });
  });

  describe("given sam belongs to acme and to a personal organization, with no enrollment", () => {
    describe("when ana turns the requirement on for acme", () => {
      /** @scenario A member who cannot prove one is held out of that organization alone */
      it("refuses acme's data with the enrollment-required code", async () => {
        const { service } = held();

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        });

        const refusal = await service
          .assertSatisfied({
            userId: "sam",
            organizationId: "acme",
            amr: ["pwd"],
          })
          .then(
            () => null,
            (error: unknown) => error,
          );
        expect(refusal).not.toBeNull();
        expect(readHandledError(serialized(refusal))?.code).toBe(
          "identity_mfa_enrollment_required",
        );
      });

      /** @scenario A member who cannot prove one is held out of that organization alone */
      it("names acme as the organization asking, and offers the setup", async () => {
        const { service } = held();

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        });

        const standing = await service.standingFor({
          userId: "sam",
          organizationId: "acme",
          amr: ["pwd"],
        });
        expect(standing.required).toBe(true);
        expect(standing.satisfaction).toEqual({ satisfied: false, by: "none" });
        expect(standing.organizationName).toBe("Acme");
      });

      /** @scenario A member who cannot prove one is held out of that organization alone */
      it("leaves sam's personal organization reachable throughout", async () => {
        const { service } = held();

        const before = await service.standingFor({
          userId: "sam",
          organizationId: "personal",
          amr: ["pwd"],
        });
        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: true,
          actorUserId: "ana",
        });
        const after = await service.standingFor({
          userId: "sam",
          organizationId: "personal",
          amr: ["pwd"],
        });

        expect(before.satisfaction.satisfied).toBe(true);
        expect(after.satisfaction.satisfied).toBe(true);
        expect(after.required).toBe(false);
      });
    });
  });

  describe("given members of acme are held at the enrollment gate", () => {
    describe("when ana turns the requirement off", () => {
      /** @scenario Turning the requirement off lets the held members straight back in */
      it("lets them reach acme's data without signing in again", async () => {
        const { service } = held({ mfaRequired: true });
        sessions.hold({
          sessionId: "sam-session",
          userId: "sam",
          amr: ["pwd"],
        });

        const before = await service.standingForSession({
          userId: "sam",
          organizationId: "acme",
          sessionId: "sam-session",
        });
        expect(before.satisfaction.satisfied).toBe(false);

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: false,
          actorUserId: "ana",
        });

        const after = await service.standingForSession({
          userId: "sam",
          organizationId: "acme",
          // The same session id. Nothing was minted and nothing was ended.
          sessionId: "sam-session",
        });
        expect(after.satisfaction.satisfied).toBe(true);
        expect(sessions.ended).toEqual([]);
        expect(sessions.held.has("sam-session")).toBe(true);
      });

      /** @scenario Turning the requirement off lets the held members straight back in */
      it("leaves the members who did set one up holding it, still asked for it", async () => {
        const { service } = held({ mfaRequired: true });

        await service.setRequirement({
          organizationId: "acme",
          mfaRequired: false,
          actorUserId: "ana",
        });

        // Ana set one up. Turning the organization's requirement off is not a
        // reset: her account still carries it, and her sign-ins are still
        // challenged, which is what the account-level answer means.
        const factors = await service.memberFactors({ organizationId: "acme" });
        const ana = factors.find((member) => member.userId === "ana");
        expect(ana?.accountEnrollmentEnabled).toBe(true);
        expect(ana?.satisfaction).toEqual({
          satisfied: true,
          by: "account_enrollment",
        });
      });
    });
  });

  function held({ mfaRequired = false }: { mfaRequired?: boolean } = {}) {
    return serviceFor({
      organizations: {
        acme: { mfaRequired, name: "Acme", slug: "acme" },
        personal: { mfaRequired: false, name: "Sam's workspace", slug: "sam" },
      },
      members: {
        acme: [
          member({ userId: "sam" }),
          member({ userId: "ana", accountEnrollmentEnabled: true }),
        ],
        personal: [member({ userId: "sam" })],
      },
      sessions,
    });
  }
});

function member({
  userId,
  accountEnrollmentEnabled = false,
  passkeyCount = 0,
}: {
  userId: string;
  accountEnrollmentEnabled?: boolean;
  passkeyCount?: number;
}): Member {
  return {
    userId,
    name: userId,
    email: `${userId}@acme.com`,
    accountEnrollmentEnabled,
    passkeyCount,
  };
}

/**
 * The refusal as it reaches a browser.
 *
 * Read through the wire shape rather than with `instanceof`: the code is what
 * the contract promises, and the class is not what survives a boundary.
 */
function serialized(error: unknown): unknown {
  const handled = error as { code?: string; httpStatus?: number };
  return { error: handled.code, status: handled.httpStatus };
}
