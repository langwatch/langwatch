import {
  IdentityMfaEnrollmentRequiredError,
  IdentityMfaRequirementNotLicensedError,
} from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import {
  type OrganizationMfaServiceDeps,
  OrganizationMfaService,
} from "../organization-mfa.service";

const organizationId = "org-acme";

const fixture = ({
  required = false,
  offered = true,
  entitled = true,
  enrolled = false,
}: {
  required?: boolean;
  offered?: boolean;
  entitled?: boolean;
  enrolled?: boolean;
} = {}) => {
  let storedRequired = required;
  const sessions = new Map([
    ["session-ana", { userId: "ana", active: true, amr: ["pwd"] }],
    ["session-olga", { userId: "olga", active: true, amr: ["pwd"] }],
  ]);
  const factors = new Map([
    ["ana", { accountEnrollmentEnabled: enrolled, passkeyCount: 0 }],
    ["olga", { accountEnrollmentEnabled: true, passkeyCount: 1 }],
  ]);
  const write = vi.fn(async (args: {
    organizationId: string;
    mfaRequired: boolean;
  }) => {
    storedRequired = args.mfaRequired;
  });
  const notify = vi.fn<OrganizationMfaServiceDeps["notifier"]["requirementTurnedOn"]>(
    async () => void 0,
  );
  const entitlement = vi.fn(async () => entitled);
  const sessionReads = vi.fn(async ({ sessionId }: { sessionId: string }) =>
    sessions.get(sessionId)?.amr ?? null,
  );
  const deps: OrganizationMfaServiceDeps = {
    settings: {
      read: async () => ({
        mfaRequired: storedRequired,
        name: "Acme",
        slug: "acme",
      }),
      write,
    },
    sessions: { amrFor: sessionReads },
    members: {
      membersOf: async () =>
        [...factors].map(([userId, factor]) => ({
          userId,
          name: userId,
          email: `${userId}@example.com`,
          ...factor,
        })),
      accountFactorFor: async ({ userId }) =>
        factors.get(userId) ?? {
          accountEnrollmentEnabled: false,
          passkeyCount: 0,
        },
      isMember: async ({ userId }) => factors.has(userId),
    },
    connections: { assertedFactorsFor: async () => null },
    notifier: { requirementTurnedOn: notify },
    offered: () => offered,
    entitled: entitlement,
  };

  return {
    service: new OrganizationMfaService(deps),
    sessions,
    factors,
    write,
    notify,
    entitlement,
    required: () => storedRequired,
  };
};

describe("OrganizationMfaService requirement lifecycle", () => {
  /** @scenario "Turning the requirement on ends no session" */
  /** @scenario "Turning the requirement on is recorded with who did it" */
  it("records the actor and members without changing any live session", async () => {
    const subject = fixture();
    const before = structuredClone([...subject.sessions]);

    await expect(
      subject.service.setRequirement({
        organizationId,
        mfaRequired: true,
        actorUserId: "admin-sam",
      }),
    ).resolves.toEqual({ previous: false, next: true });

    expect(subject.notify).toHaveBeenCalledWith({
      organizationId,
      actorUserId: "admin-sam",
      memberUserIds: ["ana", "olga"],
    });
    expect([...subject.sessions]).toEqual(before);
  });

  /** @scenario "Turning the requirement off lets the held members straight back in" */
  it("re-evaluates the same weak session as admitted after the setting is off", async () => {
    const subject = fixture({ required: true });

    await expect(
      subject.service.assertSatisfied({
        userId: "ana",
        organizationId,
        amr: ["pwd"],
      }),
    ).rejects.toBeInstanceOf(IdentityMfaEnrollmentRequiredError);

    await subject.service.setRequirement({
      organizationId,
      mfaRequired: false,
      actorUserId: "admin-sam",
    });

    await expect(
      subject.service.assertSatisfied({
        userId: "ana",
        organizationId,
        amr: ["pwd"],
      }),
    ).resolves.toBeUndefined();
    expect(subject.sessions.get("session-ana")?.active).toBe(true);
  });

  /** @scenario "Turning the requirement on without the plan is refused by the server" */
  it("refuses before writing or notifying, while keeping the off path available", async () => {
    const subject = fixture({ entitled: false });

    await expect(
      subject.service.setRequirement({
        organizationId,
        mfaRequired: true,
        actorUserId: "admin-sam",
      }),
    ).rejects.toBeInstanceOf(IdentityMfaRequirementNotLicensedError);

    expect(subject.required()).toBe(false);
    expect(subject.write).not.toHaveBeenCalled();
    expect(subject.notify).not.toHaveBeenCalled();

    const releasing = fixture({ required: true, entitled: false });
    await expect(
      releasing.service.setRequirement({
        organizationId,
        mfaRequired: false,
        actorUserId: "admin-sam",
      }),
    ).resolves.toEqual({ previous: true, next: false });
    expect(releasing.entitlement).not.toHaveBeenCalled();
    expect(releasing.required()).toBe(false);
  });

  /** @scenario "Turning the flag off leaves people who set one up signed in" */
  it("stops enforcing without erasing factors or ending sessions", async () => {
    const subject = fixture({ required: true, offered: false, enrolled: true });
    const factorBefore = structuredClone(subject.factors.get("ana"));

    await expect(
      subject.service.standingForSession({
        userId: "ana",
        organizationId,
        sessionId: "session-ana",
      }),
    ).resolves.toMatchObject({ required: false, satisfaction: { satisfied: true } });

    expect(subject.factors.get("ana")).toEqual(factorBefore);
    expect(subject.sessions.get("session-ana")?.active).toBe(true);
    expect(subject.write).not.toHaveBeenCalled();
  });
});
