/**
 * @vitest-environment node
 * The plan-limit surface. The client's pre-check is advisory, so the server
 * re-verifies before raising an alert nobody can retract.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestLicensingApp } from "../../testing.ts";
import { callerEmailFact, licenseEnforcementTrpcTransport } from "../license-enforcement.trpc.ts";
import { licensingTrpcTestPorts, type LicensingTrpcTestContext } from "./licensing.trpc.harness.ts";

const ORGANIZATION = "org_acme";

const checkLimit = vi.fn();
const notifyLimitReached = vi.fn();
const reportError = vi.fn();

// The whole application, with everything the limit surface does not reach left
// to the real implementation rather than a stub.
const licensing = createTestLicensingApp(checkLimit, reportError, notifyLimitReached);

const trpc = initTRPC.context<LicensingTrpcTestContext>().create();
const router = createTrpcRuntime<LicensingTrpcTestContext>({
  root: trpc,
  procedure: trpc.procedure,
  ports: licensingTrpcTestPorts(),
}).mount(licenseEnforcementTrpcTransport, () => licensing, {
  // The address is the PROCESS's to resolve, off the session it authenticated.
  facts: [bindTrpcFact(callerEmailFact, (ctx) => ctx.email ?? null)],
});

const caller = router.createCaller({
  actor: { id: "user_ana" },
  email: "ana@acme.com",
});

describe("the plan-limit surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyLimitReached.mockResolvedValue(undefined);
  });

  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "checkAllLimits",
        "checkLimit",
        "reportLimitBlocked",
      ]);
    });

    it("reads with a query and reports with a mutation", () => {
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        checkLimit: "query",
        checkAllLimits: "query",
        reportLimitBlocked: "mutation",
      });
    });
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
      checkLimit.mockImplementation(async ({ limitType }: { limitType: string }) => ({
        allowed: limitType === "members",
        current: 1,
        max: 2,
        limitType,
      }));

      const limits = await caller.checkAllLimits({ organizationId: ORGANIZATION });

      expect(Object.keys(limits).sort()).toEqual(["members", "membersLite"]);
      expect(limits.members?.allowed).toBe(true);
      expect(limits.membersLite?.allowed).toBe(false);
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

      expect(notifyLimitReached).toHaveBeenCalledWith({
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

      expect(notifyLimitReached).not.toHaveBeenCalled();
    });

    it("reports a failed notification instead of failing the mutation", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        max: 5,
        limitType: "members",
      });
      const failure = new Error("notification transport unavailable");
      notifyLimitReached.mockRejectedValue(failure);

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
