/**
 * @vitest-environment node
 *
 * The backoffice's connected billing surface: who reaches it, and what it
 * records when finance acts on an invoice.
 *
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { connectedBillingRouter } from "../connectedBilling";

const { mockService, mockOverview, mockAuditLog } = vi.hoisted(() => ({
  mockService: {
    onboard: vi.fn(),
    addCommit: vi.fn(),
    renew: vi.fn(),
    completeRenewalIfDue: vi.fn(),
    markPaidOutOfBand: vi.fn(),
  },
  mockOverview: vi.fn(),
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

/** The service has its own suite; here it is a spy that says which verb was reached. */
vi.mock("../../../../../ee/billing/connected/connectedBilling.prisma", () => ({
  createConnectedBillingService: () => mockService,
}));

vi.mock("../../../../../ee/billing/connected/connectedBillingOverview", () => ({
  readConnectedBillingOverview: mockOverview,
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
  signUpConfirmationEndpoint: () => ({
    confirmSignUpAddress: async () => undefined,
  }),
  twoStepAccount: () => ({ requiringOrganizations: async () => false }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));

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
  return connectedBillingRouter.createCaller(ctx);
}

const TERM_START = new Date("2026-09-19T00:00:00.000Z");
const TERM_END = new Date("2027-09-19T00:00:00.000Z");
const CONTRACT = {
  organizationId: "org_acme",
  termStartsAt: TERM_START,
  termEndsAt: TERM_END,
  seats: 50,
  seatRateCents: 60_000,
  seatCurrency: "USD" as const,
  commitUsdCents: 100_000,
};

describe("the back-office connected billing surface", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockAuditLog.mockResolvedValue(undefined);
    mockOverview.mockResolvedValue({ account: null });
    mockService.onboard.mockResolvedValue({ id: "cba_1" });
    mockService.addCommit.mockResolvedValue({ stripeCreditGrantId: "cg_1" });
    mockService.renew.mockResolvedValue({ id: "cba_1" });
    mockService.completeRenewalIfDue.mockResolvedValue("waiting");
    mockService.markPaidOutOfBand.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("given an organization admin who is not a LangWatch operator", () => {
    it("answers every procedure with a not-found that names nothing, and commands nothing", async () => {
      const caller = buildCaller("admin@acme.com");
      const attempts = [
        () => caller.get({ organizationId: "org_acme" }),
        () =>
          caller.onboard({
            ...CONTRACT,
            organizationName: "ACME",
            billingEmail: "billing@acme.test",
            bankTransfer: null,
          }),
        () =>
          caller.addCommit({
            organizationId: "org_acme",
            amountUsdCents: 50_000,
          }),
        () => caller.renew(CONTRACT),
        () => caller.completeRenewalIfDue({ organizationId: "org_acme" }),
        () => caller.markPaidOutOfBand({ stripeInvoiceId: "in_1" }),
      ];

      for (const attempt of attempts) {
        const denial = await attempt().then(
          () => {
            throw new Error("the back office gate let the call through");
          },
          (error: unknown) => error as { code: string; message: string },
        );
        expect(denial.code).toBe("NOT_FOUND");
        expect(denial.message).not.toMatch(/billing|invoice|backoffice|admin/i);
      }

      for (const verb of Object.values(mockService)) {
        expect(verb).not.toHaveBeenCalled();
      }
      expect(mockOverview).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch operator and an open invoice that was paid by wire", () => {
    /** @scenario Finance marks an invoice paid out of band from the backoffice */
    it("pays it without a charge through the payment provider, and records who did it", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.markPaidOutOfBand({ stripeInvoiceId: "in_wired" });

      expect(mockService.markPaidOutOfBand).toHaveBeenCalledWith({
        stripeInvoiceId: "in_wired",
      });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "connectedBilling.markPaidOutOfBand",
          targetId: "in_wired",
        }),
      );
    });
  });

  describe("given a LangWatch operator onboarding a customer", () => {
    it("passes the operator to the service and records the terms", async () => {
      const caller = buildCaller("olive@langwatch.ai");

      await caller.onboard({
        ...CONTRACT,
        organizationName: "ACME",
        billingEmail: "billing@acme.test",
        bankTransfer: { type: "eu_bank_transfer", country: "NL" },
      });

      expect(mockService.onboard).toHaveBeenCalledWith(
        expect.objectContaining({
          operatorId: "user_olive",
          bankTransfer: { type: "eu_bank_transfer", country: "NL" },
        }),
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "connectedBilling.onboard" }),
      );
    });
  });
});
