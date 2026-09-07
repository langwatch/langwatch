import type { DeclaredScopeId } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";
import {
  assertSecondFactorSatisfied,
  type MfaGateDeps,
  newMfaGateCache,
} from "../mfa-gate";

/**
 * The organization's enrollment gate, enforced on the way into its data (D06
 * follow-up 2).
 *
 * The two properties worth a test of their own are the ones that decide
 * whether this can ship at all: with the flag off it costs nothing — not a
 * refusal, not a query — and with it on one person costs one query however
 * many procedures a request batches.
 */

const projectScope: DeclaredScopeId = { tier: "project", id: "proj_1" };

const gateOver = ({
  offered = true,
  isPersonal = false,
  satisfied = true,
}: {
  offered?: boolean;
  isPersonal?: boolean;
  satisfied?: boolean;
} = {}) => {
  const ownerOf = vi.fn(async () => ({
    organizationId: "org_acme",
    isPersonal,
  }));
  const standingForSession = vi.fn(async () => ({
    organizationId: "org_acme",
    organizationName: "acme",
    required: !satisfied,
    satisfaction: satisfied
      ? ({ satisfied: true, by: "account_enrollment" } as const)
      : ({ satisfied: false, by: "none" } as const),
    holdsPasskey: false,
  }));
  const deps: MfaGateDeps = {
    offered: () => offered,
    scopes: { ownerOf },
    organizationMfa: () =>
      ({ standingForSession }) as unknown as ReturnType<
        MfaGateDeps["organizationMfa"]
      >,
    cache: newMfaGateCache(),
  };
  return { deps, ownerOf, standingForSession };
};

describe("the enrollment gate on the way into an organization's data", () => {
  describe("given two-step verification is not offered on this deployment", () => {
    describe("when a permission is checked", () => {
      it("refuses nothing", async () => {
        const { deps } = gateOver({ offered: false, satisfied: false });
        await expect(
          assertSecondFactorSatisfied({
            deps,
            userId: "sam",
            sessionId: "sess_1",
            scope: projectScope,
          }),
        ).resolves.toBeUndefined();
      });

      it("costs not one extra query", async () => {
        const { deps, ownerOf, standingForSession } = gateOver({
          offered: false,
          satisfied: false,
        });

        await assertSecondFactorSatisfied({
          deps,
          userId: "sam",
          sessionId: "sess_1",
          scope: projectScope,
        });

        expect(ownerOf).not.toHaveBeenCalled();
        expect(standingForSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a member who cannot prove a second factor", () => {
    describe("when they reach the requiring organization's data", () => {
      it("refuses with the code the enrollment gate renders copy for", async () => {
        const { deps } = gateOver({ satisfied: false });
        const error = await assertSecondFactorSatisfied({
          deps,
          userId: "sam",
          sessionId: "sess_1",
          scope: projectScope,
        }).catch((thrown: unknown) => thrown);

        // The code, never the prose: a handled error crosses boundaries and
        // its message is copy that will change.
        expect((error as { code?: string }).code).toBe(
          "identity_mfa_enrollment_required",
        );
      });
    });

    describe("when the scope is their own personal workspace", () => {
      it("lets them through untouched", async () => {
        const { deps, standingForSession } = gateOver({
          satisfied: false,
          isPersonal: true,
        });

        await expect(
          assertSecondFactorSatisfied({
            deps,
            userId: "sam",
            sessionId: "sess_1",
            scope: projectScope,
          }),
        ).resolves.toBeUndefined();
        expect(standingForSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a batch of procedure calls on one request", () => {
    describe("when each of them checks a permission", () => {
      it("asks the same person about the same organization once", async () => {
        const { deps, ownerOf, standingForSession } = gateOver();

        await Promise.all(
          Array.from({ length: 12 }, () =>
            assertSecondFactorSatisfied({
              deps,
              userId: "sam",
              sessionId: "sess_1",
              scope: projectScope,
            }),
          ),
        );

        expect(standingForSession).toHaveBeenCalledTimes(1);
        expect(ownerOf).toHaveBeenCalledTimes(1);
      });

      it("asks again for a different person on the same scope", async () => {
        const { deps, standingForSession } = gateOver();

        await assertSecondFactorSatisfied({
          deps,
          userId: "sam",
          sessionId: "sess_1",
          scope: projectScope,
        });
        await assertSecondFactorSatisfied({
          deps,
          userId: "ana",
          sessionId: "sess_2",
          scope: projectScope,
        });

        expect(standingForSession).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given an organization-tier scope", () => {
    it("resolves the organization without a lookup at all", async () => {
      const { deps, ownerOf, standingForSession } = gateOver();

      await assertSecondFactorSatisfied({
        deps,
        userId: "sam",
        sessionId: "sess_1",
        scope: { tier: "organization", id: "org_acme" },
      });

      expect(ownerOf).not.toHaveBeenCalled();
      expect(standingForSession).toHaveBeenCalledTimes(1);
    });
  });
});
