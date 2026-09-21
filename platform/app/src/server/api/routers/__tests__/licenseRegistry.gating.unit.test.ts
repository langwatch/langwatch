/**
 * @vitest-environment node
 *
 * The backoffice's license registry surface: who reaches it, and what its audit
 * trail is allowed to hold.
 *
 * Corresponds to specs/self-hosting/connected-services/license-registry.feature.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { licenseRegistryRouter } from "../licenseRegistry";

const { mockService, mockAuditLog } = vi.hoisted(() => ({
  mockService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    issue: vi.fn(),
    registerLegacy: vi.fn(),
    revoke: vi.fn(),
    reissue: vi.fn(),
    resetInstanceBinding: vi.fn(),
    updateTerms: vi.fn(),
    linkToOrganization: vi.fn(),
  },
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

/** The service has its own suite; here it is a spy that says which verb was reached. */
vi.mock("../../../../../ee/licensing/registry/composition", () => ({
  createLicenseRegistryService: () => mockService,
}));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  ssoConnections: vi.fn(),
  addressRoutesToConnection: async () => false,
  BACKUP_CODE_COUNT: 10,
  betterAuthInstance: () => ({ provide: () => undefined }),
  deploymentIsFederationCapable: () => false,
  deploymentOffersPasskeys: () => true,
  identityBridgeCeremonies: () => ({}),
  identityCeremonies: () => ({}),
  // `betterAuth()` builds its adapter eagerly at module load, and this suite's
  // import graph reaches it through the tRPC module.
  identityStorageAdapter: () => memoryAdapter({}),
  lastWayInGuard: () => ({
    refuseIfItClosesTheLastDoor: async () => undefined,
  }),
  mfaCeremonies: () => ({}),
  organizationMfa: () => ({
    standingForSession: async () => ({ satisfaction: { satisfied: true } }),
  }),
  PASSWORD_HASH_ROUNDS: 10,
  passkeySignUp: () => ({}),
  passwordResetSessionBridge: () => ({
    recordPasswordReset: () => undefined,
    signInAfterPasswordReset: async () => undefined,
  }),
  resolveSignInMethodPolicy: async () => ({}),
  secondaryStorage: () => ({ configured: false, connection: () => null }),
  sessionCallbackEvidence: () => ({}),
  sessionClaims: () => ({}),
  sessionRevocation: () => ({ revokeAll: async () => undefined }),
  ssoAssertion: () => ({}),
  signUpConfirmationEndpoint: () => ({
    confirmSignUpAddress: async () => undefined,
  }),
  twoStepAccount: () => ({ requiringOrganizations: async () => false }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    const passthrough = async ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    };
    return {
      ...actual,
      skipPermissionCheck: (arg?: any) =>
        arg && typeof arg.next === "function" ? passthrough(arg) : passthrough,
    };
  },
);

function buildCaller(email: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_olive", email }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return licenseRegistryRouter.createCaller(ctx);
}

const NEXT_YEAR = new Date("2027-09-19T00:00:00.000Z");
const ISSUE_INPUT = {
  customer: { organizationId: "org_acme" },
  email: "ops@acme.test",
  planType: "ENTERPRISE" as const,
  maxMembers: 50,
  expiresAt: NEXT_YEAR,
};

describe("the back-office license registry surface", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockAuditLog.mockResolvedValue(undefined);
    mockService.getAll.mockResolvedValue({ licenses: [], total: 0 });
    mockService.issue.mockResolvedValue({
      licenseKey: "signed-license",
      license: { id: "il_1", organizationId: "org_acme", maxMembers: 50 },
    });
    mockService.registerLegacy.mockResolvedValue({ id: "il_2" });
  });

  afterEach(() => {
    // Assigning an undefined stores the string "undefined", which is a
    // configured staff list as far as the next test is concerned.
    if (originalAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  describe("given an organization admin who is not a LangWatch operator", () => {
    /** @scenario Only a LangWatch operator can issue or manage licenses */
    it("answers every procedure with a not-found that names nothing, and commands nothing", async () => {
      const caller = buildCaller("admin@acme.com");
      const attempts = [
        () => caller.getAll({ page: 0, pageSize: 25 }),
        () => caller.getById({ id: "il_1" }),
        () => caller.issue(ISSUE_INPUT),
        () =>
          caller.registerLegacy({
            licenseKey: "pasted",
            organizationId: "org_acme",
          }),
        () => caller.revoke({ id: "il_1", reason: "leaked key" }),
        () => caller.reissue({ id: "il_1", expiresAt: NEXT_YEAR }),
        () => caller.resetInstanceBinding({ id: "il_1" }),
        () => caller.updateTerms({ id: "il_1", services: ["instant_evals"] }),
        () =>
          caller.linkToOrganization({ id: "il_1", organizationId: "org_acme" }),
      ];

      for (const attempt of attempts) {
        const denial = await attempt().then(
          () => {
            throw new Error("the back office gate let the call through");
          },
          (error: unknown) => error as { code: string; message: string },
        );
        expect(denial.code).toBe("NOT_FOUND");
        expect(denial.message).not.toMatch(
          /license|registry|backoffice|admin/i,
        );
      }

      for (const verb of Object.values(mockService)) {
        expect(verb).not.toHaveBeenCalled();
      }
      // The pipeline audits the denied attempts, which is wanted. What it
      // must not do is keep the license that was pasted into one of them.
      expect(JSON.stringify(mockAuditLog.mock.calls)).not.toContain("pasted");
    });
  });

  describe("given a LangWatch operator", () => {
    it("lists licenses and records the read", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.getAll({ page: 0, pageSize: 25 });

      expect(mockService.getAll).toHaveBeenCalledTimes(1);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "licenseRegistry.getAll" }),
      );
    });

    it("issues with the operator recorded, and no private key anywhere in the request", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.issue(ISSUE_INPUT);

      const sent = mockService.issue.mock.calls[0]?.[0];
      expect(sent).toMatchObject({ operatorId: "user_olive" });
      expect(JSON.stringify(sent)).not.toMatch(/privateKey|BEGIN/);
    });

    it("drops a signing key smuggled into the input before it reaches the service", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.issue({
        ...ISSUE_INPUT,
        privateKey: "-----BEGIN PRIVATE KEY-----",
      } as never);

      expect(JSON.stringify(mockService.issue.mock.calls[0]?.[0])).not.toMatch(
        /BEGIN PRIVATE KEY/,
      );
    });

    describe("when the registry refuses a command", () => {
      /** @scenario A refused license command is still recorded */
      it("records the attempt with the refusal and lets it reach the operator", async () => {
        mockService.revoke.mockRejectedValueOnce(
          Object.assign(new Error("already revoked"), {
            code: "issued_license_not_active",
          }),
        );
        const caller = buildCaller("olive@langwatch.ai");

        await expect(
          caller.revoke({ id: "il_1", reason: "leaked" }),
        ).rejects.toThrow();

        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "licenseRegistry.revoke",
            targetId: "il_1",
            error: expect.objectContaining({ message: "already revoked" }),
          }),
        );
      });

      it("keeps a pasted license out of the failure entry too", async () => {
        mockService.registerLegacy.mockRejectedValueOnce(
          new Error("license_already_registered"),
        );
        const caller = buildCaller("olive@langwatch.ai");

        await expect(
          caller.registerLegacy({
            licenseKey: "pasted-license-text",
            organizationId: "org_acme",
          }),
        ).rejects.toThrow();

        expect(JSON.stringify(mockAuditLog.mock.calls)).not.toContain(
          "pasted-license-text",
        );
      });
    });

    it("never writes a license key to the audit log", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.registerLegacy({
        licenseKey: "pasted-license-text",
        organizationId: "org_acme",
      });
      await caller.issue(ISSUE_INPUT);

      const audited = JSON.stringify(mockAuditLog.mock.calls);
      expect(audited).not.toContain("pasted-license-text");
      expect(audited).not.toContain("signed-license");
    });
  });
});
