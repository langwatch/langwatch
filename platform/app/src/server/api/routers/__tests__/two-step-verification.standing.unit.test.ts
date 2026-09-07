/** @vitest-environment node */

/**
 * The recovery read through the real tRPC procedure. A member held by the MFA
 * condition must be able to read the standing that paints their setup screen,
 * without weakening the procedure's session or membership boundaries.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationMfaService } from "~/server/app-layer/identity/organization-mfa.service";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { apiKeyRouter } from "../apiKey";
import { twoStepVerificationRouter } from "../twoStepVerification";

const { organizationMfaMock, setRequirementMock } = vi.hoisted(() => ({
  organizationMfaMock: vi.fn(),
  setRequirementMock: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    permissions: {
      getDecision: vi.fn(async () => ({
        permitted: true,
        organizationRole: "ADMIN",
        denialReason: null,
      })),
    },
  }),
  tryGetApp: () => null,
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  organizationMfa: () => organizationMfaMock(),
  twoStepVerification: () => ({}),
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(async () => void 0),
}));

const members = {
  membersOf: vi.fn(async () => []),
  accountFactorFor: vi.fn(async () => ({
    accountEnrollmentEnabled: false,
    passkeyCount: 0,
  })),
  isMember: vi.fn(
    async ({
      userId,
      organizationId,
    }: {
      userId: string;
      organizationId: string;
    }) => userId === "sam" && organizationId === "org-acme",
  ),
};

const service = new OrganizationMfaService({
  settings: {
    read: vi.fn(async () => ({
      mfaRequired: true,
      name: "Acme",
      slug: "acme",
    })),
    write: vi.fn(async () => void 0),
  },
  sessions: { amrFor: vi.fn(async () => null) },
  members,
  connections: { assertedFactorsFor: vi.fn(async () => null) },
  notifier: { requirementTurnedOn: vi.fn(async () => void 0) },
  offered: () => true,
  entitled: vi.fn(async () => true),
});

const contextFor = (userId: string | null) => {
  const session = userId
    ? {
        user: { id: userId, email: `${userId}@example.com` },
        sessionId: `session-${userId}`,
        expires: "2099-01-01",
      }
    : null;
  return createInnerTRPCContext({
    session,
    // If the recovery exemption regresses, this real unsatisfied standing
    // is evaluated in the middleware first and the call is refused.
    mfaGate: { offered: () => true, organizationMfa: () => service },
  });
};

const callerFor = (userId: string | null) =>
  twoStepVerificationRouter.createCaller(contextFor(userId));

describe("twoStepVerification.standing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationMfaMock.mockReturnValue(service);
  });

  describe("given a required member who has not enrolled", () => {
    /** @scenario A held member can read the standing needed to recover */
    it("returns the unsatisfied standing that paints the setup screen", async () => {
      await expect(
        callerFor("sam").standing({ organizationId: "org-acme" }),
      ).resolves.toEqual({
        organizationId: "org-acme",
        organizationName: "Acme",
        required: true,
        satisfaction: { satisfied: false, by: "none" },
        holdsPasskey: false,
      });

      expect(members.isMember).toHaveBeenCalledWith({
        userId: "sam",
        organizationId: "org-acme",
      });
    });

    /** @scenario A held member cannot carry the standing recovery exemption into API-key creation */
    it("cannot carry the recovery exemption into an API-key mutation", async () => {
      const context = contextFor("sam");
      const apiKeyCreate = vi.spyOn(context.prisma.apiKey, "create");
      const membershipRead = vi.spyOn(
        context.prisma.organizationUser,
        "findFirst",
      );

      await expect(
        twoStepVerificationRouter
          .createCaller(context)
          .standing({ organizationId: "org-acme" }),
      ).resolves.toMatchObject({
        required: true,
        satisfaction: { satisfied: false },
      });

      await expect(
        apiKeyRouter.createCaller(context).create({
          organizationId: "org-acme",
          name: "attempted bypass",
          permissionMode: "all",
          keyType: "personal",
          bindings: [],
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "identity_mfa_enrollment_required",
        }),
      });

      expect(membershipRead).not.toHaveBeenCalled();
      expect(apiKeyCreate).not.toHaveBeenCalled();
    });
  });

  describe("given no authenticated person", () => {
    /** @scenario A standing read still requires an authenticated person */
    it("still refuses before reading any organization standing", async () => {
      await expect(
        callerFor(null).standing({ organizationId: "org-acme" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(members.isMember).not.toHaveBeenCalled();
    });
  });

  describe("given an authenticated stranger", () => {
    /** @scenario A stranger cannot use standing to inspect an organization */
    it("keeps the organization's identity and requirement private", async () => {
      await expect(
        callerFor("mallory").standing({ organizationId: "org-acme" }),
      ).resolves.toMatchObject({
        organizationName: null,
        required: false,
        satisfaction: { satisfied: true },
      });

      expect(members.accountFactorFor).not.toHaveBeenCalled();
    });
  });
});

describe("twoStepVerification.setRequirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRequirementMock.mockResolvedValue({ previous: false, next: true });
    organizationMfaMock.mockReturnValue({
      setRequirement: setRequirementMock,
    });
  });

  it("uses the session actor and leaves the mutation in the audit trail", async () => {
    const caller = appRouter.createCaller(contextFor("ana"));

    await expect(
      caller.twoStepVerification.setRequirement({
        organizationId: "org-acme",
        mfaRequired: true,
      }),
    ).resolves.toEqual({ previous: false, next: true });

    expect(setRequirementMock).toHaveBeenCalledWith({
      organizationId: "org-acme",
      mfaRequired: true,
      actorUserId: "ana",
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "ana",
        // On an ordinary request `userId` is both actor and subject. The
        // separate column is populated only when those people differ.
        actorUserId: null,
        organizationId: "org-acme",
        action: "twoStepVerification.setRequirement",
        args: { organizationId: "org-acme", mfaRequired: true },
      }),
    );
  });
});
