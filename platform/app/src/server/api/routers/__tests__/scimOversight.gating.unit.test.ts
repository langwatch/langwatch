/**
 * @vitest-environment node
 *
 * Who reaches the directory-sync oversight surface, and what a refusal says
 * (ADR-122 — see specs/identity/scim-reconciliation-surfaces.feature).
 *
 * The refusal is the point: a plain not-found, byte-identical to what an
 * unregistered address answers, so a surface that reads across every
 * customer does not confirm its own existence to whoever is probing it. That
 * is the `ssoConnections` rule, and this is the same rule on one more page.
 *
 * The service is a spy here — it is real code under test in its own suite —
 * so these tests can say WHICH verb a procedure reached rather than what the
 * verb then did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { scimOversightRouter } from "../scimOversight";

const { mockService, mockAuditLog } = vi.hoisted(() => ({
  mockService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    getDirectoryIdentities: vi.fn(),
    redriveRetiredApply: vi.fn(),
  },
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("~/server/app-layer/identity/scim-reconciliation-runtime", () => ({
  scimOversight: () => mockService,
  scimReconciliation: () => ({}),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));

/**
 * The identity composition root, kept off this suite's graph.
 *
 * It resolves the whole event stack at module scope and exports a long list
 * of factories, none of which this suite asserts anything about — so it is
 * answered by a proxy that hands back an inert factory for whatever the tRPC
 * boundary happens to reach for. Naming them one by one would make this test
 * fail every time the composition root grows a service.
 */
vi.mock("~/server/app-layer/identity/runtime", () => {
  const inert = () => ({}) as unknown;
  const factories = [
    "accountIdentifiers",
    "identityBackfill",
    "identityBirth",
    "identityBridgeCeremonies",
    "identityCeremonies",
    "identityEmail",
    "identityGuards",
    "identityNewbornReconciliation",
    "identityProjectionStore",
    "identitySecretCarry",
    "identityService",
    "identityStorageAdapter",
    "joinRequests",
    "joinRequestsService",
    "mfaCeremonies",
    "mfaEnrollments",
    "organizationMfa",
    "sessionClaims",
    "sessionInventory",
    "signInDomainRoutingPort",
    "signInRouter",
    "signUpHealth",
    "signUpVerification",
    "ssoBreakGlass",
    "ssoConnections",
    "ssoDomainClaimQueue",
    "ssoSelfServe",
    "verificationCeremony",
  ];
  return {
    ...Object.fromEntries(factories.map((name) => [name, inert])),
    isAnyoneLatched: async () => false,
    isLatched: async () => false,
    routesToIdentityBranch: () => false,
    BACKUP_CODE_COUNT: 10,
  };
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  const passthrough = async ({ ctx, next }: any) => {
    ctx.permissionChecked = true;
    return next();
  };
  return {
    ...actual,
    skipPermissionCheck: (arg?: any) =>
      arg && typeof arg.next === "function" ? passthrough(arg) : passthrough,
  };
});

function buildCaller(email: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_olive", email }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return scimOversightRouter.createCaller(ctx);
}

const CONNECTION = { connectionId: "acme-okta" };

describe("the back-office directory sync surface", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockService.getAll.mockResolvedValue({ syncs: [], total: 0 });
    mockService.getById.mockResolvedValue(null);
    mockService.getDirectoryIdentities.mockResolvedValue([]);
    mockService.redriveRetiredApply.mockResolvedValue({ applied: true });
    mockAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("given a signed-in user who is not a platform operator", () => {
    /** @scenario "The surface is refused without platform operator access" */
    it("refuses it the same way an unregistered address is refused", async () => {
      const caller = buildCaller("ana@acme.com");

      const denial = await caller.getAll({ page: 0, pageSize: 25 }).catch(
        (error: unknown) =>
          error as {
            code: string;
            message: string;
            cause?: { code: string };
          },
      );

      // NOT_FOUND, not FORBIDDEN, and a message that names nothing: a
      // refusal that named the surface would tell a prober it exists and
      // they merely lack the session.
      expect(denial.code).toBe("NOT_FOUND");
      expect(denial.cause?.code).toBe("not_found");
      expect(denial.message).toBe("Not found");
      expect(denial.message).not.toMatch(/scim|directory|backoffice|admin/i);
      expect(mockService.getAll).not.toHaveBeenCalled();
    });

    it("refuses the mapping detail and the re-drive, not only the list", async () => {
      const caller = buildCaller("ana@acme.com");

      await expect(caller.getById(CONNECTION)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        caller.directoryIdentities(CONNECTION),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.redriveRetiredApply({ ...CONNECTION, retiredAtMs: 1 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(mockService.getDirectoryIdentities).not.toHaveBeenCalled();
      expect(mockService.redriveRetiredApply).not.toHaveBeenCalled();
    });
  });

  describe("given a platform operator", () => {
    it("reaches the surface and records the act with the operator on it", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.redriveRetiredApply({ ...CONNECTION, retiredAtMs: 42 });

      // Recorded like every other act on the operator surface: the operator,
      // the verb, and what it was aimed at.
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "scimOversight.redriveRetiredApply",
          targetKind: "scimSync",
          targetId: "acme-okta",
        }),
      );
      // And the operator is threaded into the command itself, so the tenant's
      // own history names them too — not only our audit trail.
      expect(mockService.redriveRetiredApply).toHaveBeenCalledWith({
        connectionId: "acme-okta",
        retiredAtMs: 42,
        operator: { userId: "user_olive" },
      });
    });
  });
});
