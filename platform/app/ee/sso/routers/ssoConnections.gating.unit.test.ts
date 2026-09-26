/**
 * @vitest-environment node
 *
 * The back office's single sign-on surface: who reaches it, what it refuses
 * by name, and the fact that nothing on it writes a field.
 *
 * Corresponds to specs/identity/sso-onboarding-tiers.feature.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { ssoConnectionsRouter } from "./ssoConnections";

const { mockService, mockAuditLog, mockSsoConnections, mockSelfServe } =
  vi.hoisted(() => ({
    mockService: {
      list: vi.fn(),
      getById: vi.fn(),
      getHistory: vi.fn(),
      approveDomainClaim: vi.fn(),
      rejectDomainClaim: vi.fn(),
      attestDomain: vi.fn(),
      activateConnection: vi.fn(),
      suspendConnection: vi.fn(),
      resumeConnection: vi.fn(),
      requestTeardown: vi.fn(),
    },
    mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
    mockSsoConnections: vi.fn(),
    mockSelfServe: {
      getMigrationProgress: vi.fn(),
      startLegacyMigration: vi.fn(),
    },
  }));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  // Read at module load by the better-auth request hooks on this router's
  // import graph (GAC-09). Locks nobody: these suites assert nothing about
  // lock-out, and a mock that omits the export fails the whole file at
  // collection rather than at an assertion.
  signInLockout: () => ({
    refuseIfLockedOut: async () => void 0,
    recordFailure: async () => void 0,
    recordSuccess: async () => void 0,
  }),
  /**
   * The service is real code under test in its own suite; here it is a spy,
   * so these tests can say WHICH verb a procedure reached rather than what
   * the verb then did. The router reaches it through this seam, so the spy
   * has to be the seam's answer — mocking the service class instead would
   * never be loaded, because this factory replaces the runtime whole.
   */
  ssoConnectionBackoffice: () => mockService,
  ssoSelfServe: () => mockSelfServe,
  ssoConnections: mockSsoConnections,
  // The credential boundary asks this before it lets a password through; no
  // organization routes this suite's addresses.
  addressRoutesToConnection: async () => false,
  BACKUP_CODE_COUNT: 10,
  betterAuthInstance: () => ({ provide: () => undefined }),
  clearSignUpConfirmationPending: async () => undefined,
  databaseHooks: () => ({}),
  credentialSessions: () => ({}),
  deploymentIsFederationCapable: () => false,
  deploymentOffersPasskeys: () => true,
  identityBridgeCeremonies: () => ({}),
  identityCeremonies: () => ({}),
  // `betterAuth()` builds its adapter EAGERLY at module load, and this
  // suite's import graph reaches it through the router. It has to be real
  // enough to initialise; better-auth's own memory engine over an empty
  // store is exactly that, and holds nothing this suite could assert
  // against by accident.
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
  ssoProvisionedUsers: () => ({}),
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
  return ssoConnectionsRouter.createCaller(ctx);
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

describe("the back-office single sign-on surface", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockService.list.mockResolvedValue({ connections: [], total: 0 });
    mockService.getById.mockResolvedValue(null);
    mockAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("given somebody outside the staff list", () => {
    it("answers a plain not-found that says nothing about the surface", async () => {
      const caller = buildCaller("ana@acme.com");

      // NOT_FOUND, not FORBIDDEN: the surface does not confirm its own
      // existence to whoever is probing it.
      await expect(
        caller.getAll({ page: 0, pageSize: 25 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // And the handled payload underneath carries the generic code and a
      // message that names nothing — no resource, no id, no surface. A
      // message naming the back office would tell a prober it exists and they
      // merely lack the session.
      // `then` with both arms rather than `catch`: the success arm throws, so
      // a call that stopped being denied fails here instead of handing the
      // assertions below an `undefined` to read properties off.
      const denial = await caller
        .attestDomain({
          ...TARGET,
          domain: "acme.com",
          evidenceRef: "ticket:SEC-123",
          note: "verified by the support operator",
        })
        .then(
          () => {
            throw new Error(
              "attestDomain resolved: the back office gate let the call through",
            );
          },
          (error: unknown) =>
            error as {
              code: string;
              message: string;
              cause?: { code: string };
            },
        );
      expect(denial.code).toBe("NOT_FOUND");
      expect(denial.cause?.code).toBe("not_found");
      expect(denial.message).toBe("Not found");
      expect(denial.message).not.toMatch(/sso|backoffice|admin|connection/i);

      // And nothing was commanded.
      expect(mockService.attestDomain).not.toHaveBeenCalled();
    });

    it("refuses every mutation on the surface, not only the read", async () => {
      const caller = buildCaller("ana@acme.com");
      const attempts = [
        () => caller.approveDomainClaim({ ...TARGET, domain: "acme.com" }),
        () =>
          caller.attestDomain({
            ...TARGET,
            domain: "acme.com",
            evidenceRef: "ticket:SEC-123",
            note: "verified by the support operator",
          }),
        () => caller.suspend({ ...TARGET, reason: null }),
        () => caller.resume(TARGET),
        () => caller.requestTeardown({ ...TARGET, reason: null }),
        () =>
          caller.startLegacyMigration({
            organizationId: TARGET.organizationId,
            legacyConnectionId: TARGET.connectionId,
            providerId: "okta",
            idp: {
              protocol: "oidc",
              issuer: "https://login.acme.test",
              clientId: "client",
              clientSecret: "secret",
            },
          }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(mockService.requestTeardown).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch operator", () => {
    /** @scenario "An operator cannot change a connection except by commanding it" */
    it("turns every change into a guarded command carrying the operator", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.approveDomainClaim({ ...TARGET, domain: "acme.com" });
      await caller.attestDomain({
        ...TARGET,
        domain: "acme.com",
        evidenceRef: "ticket:SEC-123",
        note: "verified by the support operator",
      });
      await caller.activate({ ...TARGET, testLoginAccountId: "acc_test" });
      await caller.suspend({ ...TARGET, reason: null });
      await caller.resume(TARGET);

      // Every one reached a lifecycle verb, and every one carried the
      // operator as the actor. The surface mints that; no input supplies it.
      const commanded = [
        mockService.approveDomainClaim,
        mockService.attestDomain,
        mockService.activateConnection,
        mockService.suspendConnection,
        mockService.resumeConnection,
      ];
      for (const verb of commanded) {
        expect(verb).toHaveBeenCalledTimes(1);
        expect(verb.mock.calls[0]![0]).toMatchObject({
          operator: { userId: "user_olive" },
        });
      }

      // There is no verb on this router that writes a field. Every procedure
      // is one of the lifecycle's, so a "save" has nowhere to land.
      expect(Object.keys(ssoConnectionsRouter._def.procedures).sort()).toEqual([
        "activate",
        "approveDomainClaim",
        "attestDomain",
        "getAll",
        "getById",
        "getHistory",
        "getMigrationProgress",
        "rejectDomainClaim",
        "requestTeardown",
        "resume",
        "startLegacyMigration",
        "suspend",
      ]);
    });

    it("records every attempt in the audit log before the command runs", async () => {
      const caller = buildCaller("olive@langwatch.ai");
      await caller.attestDomain({
        ...TARGET,
        domain: "acme.com",
        evidenceRef: "ticket:SEC-123",
        note: "verified by the support operator",
      });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "ssoConnections.attestDomain",
          targetKind: "ssoConnection",
          targetId: "ssoc_1",
        }),
      );
    });

    it("reads migration evidence and imports supplied configuration through self-serve", async () => {
      const caller = buildCaller("olive@langwatch.ai");
      const legacy = {
        organizationId: TARGET.organizationId,
        connectionId: TARGET.connectionId,
        source: "legacy-grandfathered",
      };
      const progress = { phase: "SETUP", blockers: [] };
      mockService.getById.mockResolvedValue(legacy);
      mockSelfServe.getMigrationProgress.mockResolvedValue(progress);
      mockSelfServe.startLegacyMigration.mockResolvedValue({
        connectionId: "ssoc_replacement",
      });

      await expect(
        caller.getMigrationProgress({
          connectionId: TARGET.connectionId,
          cursor: null,
          limit: 50,
        }),
      ).resolves.toEqual(progress);
      await expect(
        caller.startLegacyMigration({
          organizationId: TARGET.organizationId,
          legacyConnectionId: TARGET.connectionId,
          providerId: "okta",
          idp: {
            protocol: "oidc",
            issuer: "https://login.acme.test",
            clientId: "client",
            clientSecret: "secret",
          },
        }),
      ).resolves.toEqual({ connectionId: "ssoc_replacement" });

      expect(mockSelfServe.startLegacyMigration).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: TARGET.organizationId,
          legacyConnectionId: TARGET.connectionId,
          providerId: "okta",
          actor: { userId: "user_olive" },
        }),
      );
      const auditArgs = mockAuditLog.mock.calls
        .map(([entry]) => entry)
        .find(
          (entry): entry is { action: string; args: Record<string, unknown> } =>
            typeof entry === "object" &&
            entry !== null &&
            "action" in entry &&
            entry.action === "ssoConnections.startLegacyMigration",
        );
      expect(auditArgs).toBeDefined();
      if (!auditArgs) throw new Error("migration audit entry was not written");
      expect(auditArgs.args).not.toHaveProperty("idp");
      expect(auditArgs.args).not.toHaveProperty("clientSecret");
    });

    /** @scenario "An operator reads a connection's history from the back office, gated like the rest of that surface" */
    it("answers the history to an operator on the staff list, and the same not-found to anybody else", async () => {
      // The same words the organization's own authentication page reads —
      // this surface reads the connection's history, it does not write a
      // second version of it.
      const history = [
        {
          eventId: "evt_1",
          occurredAtMs: 1_600_000_000_000,
          summary: "The connection was registered",
          carriedOver: false,
        },
      ];
      mockService.getHistory.mockResolvedValue(history);

      await expect(
        buildCaller("olive@langwatch.ai").getHistory({
          connectionId: "ssoc_1",
        }),
      ).resolves.toEqual(history);

      // NOT_FOUND rather than FORBIDDEN, exactly as every other procedure on
      // this surface answers: a reader outside the staff list cannot tell
      // this surface apart from a path that was never registered.
      await expect(
        buildCaller("ana@acme.com").getHistory({ connectionId: "ssoc_1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // And the refused read never reached the service — the gate is in
      // front of it, not a filter applied to what came back.
      expect(mockService.getHistory).toHaveBeenCalledTimes(1);
    });

    it("keeps a rejection note out of the audit row", async () => {
      const caller = buildCaller("olive@langwatch.ai");
      await caller.rejectDomainClaim({
        ...TARGET,
        domain: "acme.com",
        note: "the requester could not be reached at that domain",
      });

      // The note is an operator's prose about a customer, and audit rows
      // outlive the decision. The command carries it; the audit row does not.
      const [[audited]] = mockAuditLog.mock.calls as unknown as [
        [{ args: Record<string, unknown> }],
      ];
      expect(audited.args.note).toBeUndefined();
      expect(mockService.rejectDomainClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          note: "the requester could not be reached at that domain",
        }),
      );
    });
  });
});
