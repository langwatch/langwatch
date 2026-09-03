/**
 * @vitest-environment node
 *
 * Which single sign-on setup verbs an organization's plan reaches (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * The split under test is deliberate and easy to get backwards: CHANGING an
 * organization's single sign-on takes an Enterprise plan, and READING the
 * setup screen does not — because a screen that refuses to render cannot say
 * what it is refusing, and what an administrator on a smaller plan needs from
 * this page is to be told what single sign-on would take.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { ssoSetupRouter } from "../ssoSetup";

const { mockSelfServe, mockBreakGlass, mockAuditLog, mockPlan } = vi.hoisted(
  () => ({
    mockSelfServe: {
      getSetup: vi.fn(),
      registerConnection: vi.fn(),
      activate: vi.fn(),
      breakGlassHistory: vi.fn(),
      breakGlassCandidates: vi.fn(),
    },
    mockBreakGlass: { grant: vi.fn(), renew: vi.fn() },
    mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
    mockPlan: vi.fn<() => Promise<{ type: string }>>(),
  }),
);

/** Enough of better-auth's adapter shape for `betterAuth()` to finish
 *  constructing: the auth module is on this router's import graph. Hoisted
 *  because the mock factory below hands it out during module load, before
 *  this file's own statements have run. */
const stubBetterAuthAdapter = vi.hoisted(() => ({
  id: "stub",
  create: async () => ({}),
  update: async () => ({}),
  updateMany: async () => 0,
  findOne: async () => null,
  findMany: async () => [],
  delete: async () => undefined,
  deleteMany: async () => 0,
  count: async () => 0,
}));

/**
 * The composition root, mocked whole — it reaches Prisma at module scope, so
 * a unit test cannot import it.
 *
 * Behind a Proxy rather than a literal because this router's import graph
 * reaches `better-auth/index.ts` and `auth.ts`, and both read exports from
 * here at module load that have nothing to do with single sign-on setup.
 * Naming them one at a time makes this suite fail whenever an unrelated slice
 * adds one, which is noise rather than a signal: what it needs is for the
 * module to evaluate, and the two collaborators it actually asserts on are
 * named explicitly below.
 */
vi.mock("~/server/app-layer/identity/runtime", () => ({
  ssoSelfServe: () => mockSelfServe,
  ssoBreakGlass: () => mockBreakGlass,
  // Read at module load by `better-auth/index.ts`, which is on this router's
  // import graph through `auth.ts`. Nothing here asserts on them; what they
  // are for is letting the module finish evaluating.
  BACKUP_CODE_COUNT: 10,
  identityBridgeCeremonies: () => ({}),
  identityCeremonies: () => ({}),
  identityStorageAdapter: () => () => stubBetterAuthAdapter,
  // The permission middleware's strong-factor gate reads this per call. This
  // suite is about the plan gate, and no procedure here is factor-gated.
  organizationMfa: () => ({
    standingForSession: async () => ({
      satisfaction: { satisfied: true },
    }),
  }),
  deploymentOffersTwoStepVerification: () => false,
  // ADR-129 slice 21a: index.ts now composes better-auth's secondary storage
  // from this factory, and reads it EAGERLY at module load.
  secondaryStorage: () => ({ configured: false, connection: () => null }),
  betterAuthInstance: () => ({ provide: () => undefined }),
  PASSWORD_HASH_ROUNDS: 10,
  passkeySignUp: () => ({}),
  ssoAssertion: () => ({}),
  databaseHooks: () => ({}),
  sessionClaims: () => ({}),
  deploymentIsFederationCapable: () => false,
  resolveSignInMethodPolicy: async () => ({}),
  mfaCeremonies: () => ({}),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));

/**
 * The permission decision is somebody else's suite. Here it always permits,
 * so what these tests observe is the PLAN gate — which is composed after the
 * permission check on purpose, so an RBAC denial fires first.
 */
vi.mock("~/server/app-layer/app", () => {
  const app = {
    planProvider: { getActivePlan: mockPlan },
    permissions: {
      getDecision: async () => ({
        permitted: true,
        organizationRole: "ADMIN",
        denialReason: null,
      }),
    },
  };
  return { getApp: () => app, tryGetApp: () => app };
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

function caller() {
  return ssoSetupRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_ana", email: "ana@acme.com" },
        expires: "1",
      },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    }),
  );
}

const OIDC = {
  protocol: "oidc" as const,
  issuer: "https://login.acme.okta.com",
  clientId: "client_acme",
  clientSecret: "secret_acme",
};

describe("the organization's single sign-on setup surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockSelfServe.getSetup.mockResolvedValue({ availability: {} });
    mockSelfServe.registerConnection.mockResolvedValue({
      connectionId: "ssoconn_1",
    });
    mockSelfServe.activate.mockResolvedValue({ alreadyLive: false });
    mockBreakGlass.grant.mockResolvedValue({ bindingId: "bgb_1" });
  });

  describe("given an organization that is not on an Enterprise plan", () => {
    beforeEach(() => {
      mockPlan.mockResolvedValue({ type: "LAUNCH" });
    });

    /** @scenario "Registering an identity provider needs an Enterprise plan" */
    it("refuses to register an identity provider", async () => {
      const refusal = await caller()
        .register({
          organizationId: "org_acme",
          providerId: "okta",
          idp: OIDC,
        })
        .catch((error: unknown) => error);

      expect((refusal as { message: string }).message).toContain(
        "Enterprise plan",
      );
      expect(mockSelfServe.registerConnection).not.toHaveBeenCalled();
    });

    /** @scenario "Going live needs an Enterprise plan" */
    it("refuses to turn the connection on", async () => {
      const refusal = await caller()
        .activate({ organizationId: "org_acme", connectionId: "ssoconn_1" })
        .catch((error: unknown) => error);

      expect((refusal as { message: string }).message).toContain(
        "Enterprise plan",
      );
      expect(mockSelfServe.activate).not.toHaveBeenCalled();
    });

    /** @scenario "A lapsed subscription does not take the way back in away" */
    it("still grants a way back in, because the plan must never gate recovery", async () => {
      await caller().grantBreakGlass({
        organizationId: "org_acme",
        userId: "user_ben",
        expiresAtMs: 1_756_000_000_000,
      });

      expect(mockBreakGlass.grant).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          userId: "user_ben",
          grantedByUserId: "user_ana",
        }),
      );
    });

    /** @scenario "The setup screen still renders without an Enterprise plan" */
    it("still answers the setup screen", async () => {
      await expect(
        caller().getSetup({ organizationId: "org_acme" }),
      ).resolves.toBeDefined();
      expect(mockSelfServe.getSetup).toHaveBeenCalledWith({
        organizationId: "org_acme",
      });
    });
  });

  describe("given an organization on an Enterprise plan", () => {
    beforeEach(() => {
      mockPlan.mockResolvedValue({ type: "ENTERPRISE" });
    });

    it("registers the identity provider it was given", async () => {
      await caller().register({
        organizationId: "org_acme",
        providerId: "okta",
        idp: OIDC,
      });

      expect(mockSelfServe.registerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: "okta", idp: OIDC }),
      );
    });

    /** @scenario "Every change the customer makes is recorded before it is attempted" */
    it("records who tried to go live before it tries", async () => {
      mockSelfServe.activate.mockRejectedValueOnce(new Error("refused"));

      await caller()
        .activate({ organizationId: "org_acme", connectionId: "ssoconn_1" })
        .catch(() => undefined);

      // The row is there even though the command was refused: somebody asking
      // "why did this change at 03:14" needs the attempt, not only the
      // successes.
      const [entry] = mockAuditLog.mock.calls[0] as [
        { userId: string; action: string },
      ];
      expect(entry).toMatchObject({
        userId: "user_ana",
        action: "ssoSetup.activate",
      });
    });

    it("records the attempt without recording the client secret", async () => {
      await caller().register({
        organizationId: "org_acme",
        providerId: "okta",
        idp: OIDC,
      });

      const [entry] = mockAuditLog.mock.calls[0] as [
        { args: Record<string, unknown> },
      ];
      expect(JSON.stringify(entry.args)).not.toContain(OIDC.clientSecret);
      expect(entry.args).toMatchObject({ protocol: "oidc" });
    });
  });
});

describe("what the customer's own single sign-on surface never offers", () => {
  /** @scenario "Suspending a connection is not on the customer's surface" */
  it("has no verb for suspending or resuming a connection", () => {
    const verbs = Object.keys(ssoSetupRouter._def.procedures);

    // Both are LangWatch operators' levers, taken by a human at the moment a
    // connection is hurting people. Offering them here would put the lever
    // for a failing identity provider behind that identity provider.
    expect(verbs).not.toContain("suspend");
    expect(verbs).not.toContain("resume");
    expect(verbs).toContain("activate");
  });
});
