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
import type { RequestAppServices } from "~/runtime/app";
import { createInnerTRPCContext } from "../../trpc";
import { ssoConnectionsRouter } from "../ssoConnections";

const { mockService, mockAuditLog, mockSsoConnections } = vi.hoisted(() => ({
  mockService: {
    list: vi.fn(),
    getById: vi.fn(),
    registerConnection: vi.fn(),
    claimDomain: vi.fn(),
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
}));

/**
 * The service is real code under test in its own suite; here it is a spy, so
 * these tests can say WHICH verb a procedure reached rather than what the
 * verb then did.
 */
vi.mock("~/server/app-layer/identity/sso-connection-backoffice.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/app-layer/identity/sso-connection-backoffice.service")
    >();
  return {
    ...actual,
    SsoConnectionBackofficeService: class {
      list = mockService.list;
      getById = mockService.getById;
      registerConnection = mockService.registerConnection;
      claimDomain = mockService.claimDomain;
      approveDomainClaim = mockService.approveDomainClaim;
      rejectDomainClaim = mockService.rejectDomainClaim;
      attestDomain = mockService.attestDomain;
      activateConnection = mockService.activateConnection;
      suspendConnection = mockService.suspendConnection;
      resumeConnection = mockService.resumeConnection;
      requestTeardown = mockService.requestTeardown;
    },
  };
});

vi.mock("~/server/app-layer/identity/runtime", () => ({
  ssoConnections: mockSsoConnections,
  // `betterAuth()` builds its adapter EAGERLY at module load, and this
  // suite's import graph reaches it through the router. It has to be real
  // enough to initialise; better-auth's own memory engine over an empty
  // store is exactly that, and holds nothing this suite could assert
  // against by accident.
  identityStorageAdapter: () => memoryAdapter({}),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/runtime/app/features/audit-log", () => ({
  AppAuditLogRuntime: {
    clear: vi.fn(),
    install: vi.fn(),
    record: mockAuditLog,
  },
  auditLog: mockAuditLog,
}));

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
  const app = {
    ops: {
      isAdmin: (identity: { email?: string | null }) => identity.email === "olive@langwatch.ai",
    },
  } as RequestAppServices;
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_olive", email }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
    app,
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
      await expect(caller.getAll({ page: 0, pageSize: 25 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // And the handled payload underneath carries the generic code and a
      // message that names nothing — no resource, no id, no surface. A
      // message naming the back office would tell a prober it exists and they
      // merely lack the session.
      // `then` with both arms rather than `catch`: the success arm throws, so
      // a call that stopped being denied fails here instead of handing the
      // assertions below an `undefined` to read properties off.
      const denial = await caller.attestDomain({ ...TARGET, domain: "acme.com" }).then(
        () => {
          throw new Error("attestDomain resolved: the back office gate let the call through");
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
        () => caller.claimDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.approveDomainClaim({ ...TARGET, domain: "acme.com" }),
        () => caller.attestDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.suspend({ ...TARGET, reason: null }),
        () => caller.resume(TARGET),
        () => caller.requestTeardown({ ...TARGET, reason: null }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(mockService.claimDomain).not.toHaveBeenCalled();
      expect(mockService.requestTeardown).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch operator", () => {
    /** @scenario "An operator cannot change a connection except by commanding it" */
    it("turns every change into a guarded command carrying the operator", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.claimDomain({ ...TARGET, domain: "acme.com" });
      await caller.approveDomainClaim({ ...TARGET, domain: "acme.com" });
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });
      await caller.activate({ ...TARGET, testLoginAccountId: "acc_test" });
      await caller.suspend({ ...TARGET, reason: null });
      await caller.resume(TARGET);

      // Every one reached a lifecycle verb, and every one carried the
      // operator as the actor. The surface mints that; no input supplies it.
      const commanded = [
        mockService.claimDomain,
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
        "claimDomain",
        "getAll",
        "getById",
        "register",
        "rejectDomainClaim",
        "requestTeardown",
        "resume",
        "suspend",
      ]);
    });

    /** @scenario "Setting up a SAML connection is not something anybody does themselves yet" */
    it("refuses a SAML registration by name, saying to talk to LangWatch", async () => {
      const caller = buildCaller("olive@langwatch.ai");
      // The real service decides this, so the mock steps aside for one call.
      const { SsoSamlNotSelfServeError } = await import("@langwatch/identity");
      mockService.registerConnection.mockRejectedValueOnce(
        new SsoSamlNotSelfServeError("connection type saml"),
      );

      const refusal = await caller
        .register({
          organizationId: "org_acme",
          type: "saml",
          providerId: "okta",
          issuer: null,
          allowsJit: false,
        })
        .then(
          () => {
            throw new Error("register resolved: SAML was accepted as self-serve");
          },
          (error: unknown) => error as { message: string },
        );

      // The wire message for a handled error IS the code; the words the
      // reader sees come from the registry keyed by it.
      expect(refusal.message).toBe("sso_saml_not_self_serve");
    });

    it("records every attempt in the audit log before the command runs", async () => {
      const caller = buildCaller("olive@langwatch.ai");
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "ssoConnections.attestDomain",
          targetKind: "ssoConnection",
          targetId: "ssoc_1",
        }),
      );
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
