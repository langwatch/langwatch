/**
 * The plan-limit surface: what it asks the enforcement service, and when it
 * tells operations that a customer hit a ceiling.
 *
 * The report is the interesting one — the client's pre-check is advisory, so
 * the server re-verifies before raising an alert nobody can retract.
 */
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LicenseEnforcementTrpcApi,
  type LicenseEnforcementTrpcContext,
} from "../license-enforcement.api";
import { LicensingApp } from "../../../app/licensing.app";

const checkLimit = vi.fn();
const notifyResourceLimitReached = vi.fn();
const reportError = vi.fn();

const trpc = initTRPC.context<LicenseEnforcementTrpcContext>().create();

/** The process's chain is exercised in the app; here it is the identity. */
const identityPolicy = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const router = LicenseEnforcementTrpcApi.create(trpc, {
  protected: trpc.procedure,
  policy: () => identityPolicy,
});

/**
 * The whole application, with everything the limit surface does not reach left
 * as a refusal rather than a stub: if this surface ever starts asking one of
 * them, the test says so out loud instead of quietly answering.
 */
const licensing = LicensingApp.create({
  checkLimit,
  reportError,
  licenses: () => {
    throw new Error("the limit surface does not read the license service");
  },
  cryptography: () => {
    throw new Error("the limit surface does not sign anything");
  },
  configuredAuthProvider: () => {
    throw new Error("the limit surface does not read the auth provider");
  },
  platformSsoAllowed: () => {
    throw new Error("the limit surface does not read the single sign-on gate");
  },
  authProviderIsMounted: () => {
    throw new Error("the limit surface does not read the auth provider");
  },
  reportSigningFailure: () => {
    throw new Error("the limit surface signs nothing to fail");
  },
});

const caller = router.createCaller({
  app: { licensing, usageLimits: { notifyResourceLimitReached } },
  actor: () => ({ id: "user_ana" }),
  session: { user: { id: "user_ana", email: "ana@acme.com" } },
});

const ORGANIZATION = "org_acme";

describe("the plan-limit surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyResourceLimitReached.mockResolvedValue(undefined);
  });

  describe("when a limit is checked", () => {
    it("asks about the caller, not only the organization", async () => {
      checkLimit.mockResolvedValue({
        allowed: true,
        current: 3,
        max: 5,
        limitType: "members",
      });

      await caller.checkLimit({
        organizationId: ORGANIZATION,
        limitType: "members",
      });

      // A lite member is counted differently from a full one, so the caller is
      // part of the question rather than context.
      expect(checkLimit).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        limitType: "members",
        user: { id: "user_ana", email: "ana@acme.com" },
      });
    });

    it("answers every limit at once, keyed by limit type", async () => {
      checkLimit.mockImplementation(
        async ({ limitType }: { limitType: string }) => ({
          allowed: limitType === "members",
          current: 1,
          max: 2,
          limitType,
        }),
      );

      const limits = await caller.checkAllLimits({ organizationId: ORGANIZATION });

      expect(Object.keys(limits).sort()).toEqual(["members", "membersLite"]);
      expect(limits.members.allowed).toBe(true);
      expect(limits.membersLite.allowed).toBe(false);
    });
  });

  describe("when a client reports that its pre-check blocked somebody", () => {
    it("notifies operations once the server agrees the ceiling was reached", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        max: 5,
        limitType: "members",
      });

      await caller.reportLimitBlocked({
        organizationId: ORGANIZATION,
        limitType: "members",
      });

      expect(notifyResourceLimitReached).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        limitType: "members",
        current: 5,
        max: 5,
      });
    });

    it("stays silent when the ceiling was not reached", async () => {
      // A fabricated report must not raise an alert: the server's own answer
      // decides, never the client's claim.
      checkLimit.mockResolvedValue({
        allowed: true,
        current: 1,
        max: 5,
        limitType: "members",
      });

      await caller.reportLimitBlocked({
        organizationId: ORGANIZATION,
        limitType: "members",
      });

      expect(notifyResourceLimitReached).not.toHaveBeenCalled();
    });

    it("reports a failed notification instead of failing the mutation", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        max: 5,
        limitType: "members",
      });
      const failure = new Error("notification transport unavailable");
      notifyResourceLimitReached.mockRejectedValue(failure);

      // The upgrade modal is already on screen; a notification that could not
      // be sent is an operations problem, not the customer's.
      await expect(
        caller.reportLimitBlocked({
          organizationId: ORGANIZATION,
          limitType: "members",
        }),
      ).resolves.toBeUndefined();

      await new Promise((resolve) => setImmediate(resolve));
      expect(reportError).toHaveBeenCalledWith(failure);
    });
  });
});
