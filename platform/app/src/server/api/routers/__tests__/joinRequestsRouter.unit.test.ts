/** @vitest-environment node */

/**
 * The joining setting's boundary: who may change it, and what the change
 * leaves behind on the customer's audit page (D12).
 *
 * Both halves run the REAL declared-permission middleware over stubbed
 * resolvers, rather than reading the declaration back and calling that a
 * test. A declaration nobody enforces is exactly the failure the audit sweep
 * cannot see, so what is exercised here is the refusal itself.
 *
 * Spec: specs/identity/domain-auto-join.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasOrganizationPermission = vi.fn();
const auditLogMock = vi.fn(async () => undefined);
const setJoiningMock = vi.fn();

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasOrganizationPermission: (...args: unknown[]) =>
      hasOrganizationPermission(...args),
    organizationDenialReason: async () => undefined,
  };
});

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...(args as [])),
}));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  identityEmail: () => ({ verifiedEmailsOf: async () => null }),
  joinRequestsService: () => ({ setJoining: setJoiningMock }),
  // The second-factor gate runs after every permitted decision (D06). Nothing
  // here is about it, so it answers "satisfied" and gets out of the way.
  organizationMfa: () => ({
    standingForSession: async () => ({ satisfaction: { satisfied: true } }),
  }),
}));

const { isAuditLogExempt, isSelfAudited } = await import(
  "~/server/api/auditLogExemptions"
);
const { createInnerTRPCContext } = await import("~/server/api/trpc");
const { JOIN_SETTING_AUDIT_ACTION, joinRequestsRouter } = await import(
  "../joinRequests"
);

const caller = () =>
  joinRequestsRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_ana", name: "Ana", email: "ana@acme.com" },
        expires: "1",
      },
      permissionChecked: false,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  setJoiningMock.mockResolvedValue({
    previous: "request",
    next: "auto",
    previousDomains: [],
    nextDomains: ["acme.com"],
  });
});

describe("given a member who cannot manage the organization", () => {
  describe("when they try to change the joining setting", () => {
    /** @scenario Changing the setting needs the authority that gates managing the organization */
    it("is refused, and the setting is never written", async () => {
      hasOrganizationPermission.mockResolvedValue(false);

      await expect(
        caller().setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(setJoiningMock).not.toHaveBeenCalled();
    });

    /** @scenario Changing the setting needs the authority that gates managing the organization */
    it("is refused on the same authority that gates inviting", async () => {
      hasOrganizationPermission.mockResolvedValue(false);

      await caller()
        .setJoining({
          organizationId: "org_acme",
          domainJoin: "off",
          domains: [],
        })
        .catch(() => undefined);

      // Deciding who may walk in is the same decision as deciding who is
      // asked in, so it is the same permission.
      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        expect.anything(),
        "org_acme",
        "organization:manage",
      );
    });
  });
});

describe("given an administrator changing the joining setting", () => {
  describe("when the change is saved", () => {
    /** @scenario The setting change is itself audited */
    it("puts the change on the audit page with the actor and both values", async () => {
      hasOrganizationPermission.mockResolvedValue(true);

      await caller().setJoining({
        organizationId: "org_acme",
        domainJoin: "auto",
        domains: ["acme.com"],
      });

      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_ana",
          organizationId: "org_acme",
          action: JOIN_SETTING_AUDIT_ACTION,
          args: {
            from: "request",
            to: "auto",
            fromDomains: [],
            toDomains: ["acme.com"],
          },
        }),
      );
    });

    /** @scenario The setting change is itself audited */
    it("records it once, as the richer fact rather than the arguments", () => {
      // The generic mutation audit stands down for this path, because the
      // arguments carry only what the setting BECAME — and an administrator
      // reading the page months later needs what it was as well. Two rows for
      // one change would make the page harder to read, not more complete.
      expect(isAuditLogExempt("joinRequests.setJoining")).toBe(true);
      expect(isSelfAudited("joinRequests.setJoining")).toBe(true);
    });
  });
});
