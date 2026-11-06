import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * Coupons behind the platform door: non-staff 404, staff lacking ops:manage refused a write by
 * name; billing is never reached. Spec: coupons.feature.
 */
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { billingCouponsTrpcTransport } from "../billing-coupons.trpc.ts";
import { operatorContext } from "../connected-billing.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-viewer": ["ops:view"],
  "user-staff": ["ops:view", "ops:manage"],
};

const root = TrpcRootDefinition.forContext<Context>().create({});

function members(): TrpcRuntimeMembers<Context> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: (GRANTS[userId] ?? []).includes(permission),
        }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function couponsDoor(reached: string[]) {
  const app = createApiFixture<BillingApi>({
    listCoupons: async () => {
      reached.push("listCoupons");
      return { coupons: [] };
    },
    createCoupon: async () => {
      reached.push("createCoupon");
      throw new Error("the door admitted the caller");
    },
    deactivatePromotionCode: async () => {
      reached.push("deactivatePromotionCode");
      throw new Error("the door admitted the caller");
    },
  });
  const runtime = createTrpcRuntime<Context>({ root, procedure: root.procedure, members: members() });
  const mountOptions = {
    middlewareContext: [bindTrpcMiddlewareContext(operatorContext, (ctx: Context) => ctx.operator)],
  };
  const as = (id: string) => ({
    actor: { type: "user", id } as const,
    operator: { id, email: `${id}@langwatch.test` },
  });

  return (id: string) =>
    runtime.mount(billingCouponsTrpcTransport, () => app, mountOptions).createCaller(as(id));
}

function codeOf(failure: unknown): { trpc: string; code: string } {
  const error = failure as { code: string; cause?: { code?: string } };
  return { trpc: error.code, code: error.cause?.code ?? "" };
}

const REQUEST = { percentOff: 50, duration: "once" as const, code: "WELCOME50" };

describe("coupons at the platform door", () => {
  describe("when someone who is not a platform operator asks", () => {
    /** @scenario "Someone who is not a platform operator is answered not found" */
    it("answers not_found to a read and a write before billing is reached", async () => {
      const reached: string[] = [];
      const stranger = couponsDoor(reached)("user-stranger");

      const read = await stranger.list({}).catch((error: unknown) => error);
      const write = await stranger.create(REQUEST).catch((error: unknown) => error);

      expect(codeOf(read)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(codeOf(write)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(reached).toEqual([]);
    });
  });

  describe("when a view-only operator reads, then writes", () => {
    /** @scenario "An operator with view access cannot create a coupon" */
    it("admits the list and refuses create and deactivate with permission_denied", async () => {
      const reached: string[] = [];
      const viewer = couponsDoor(reached)("user-viewer");

      await viewer.list({});
      const refusals = await Promise.all([
        viewer.create(REQUEST).catch((error: unknown) => error),
        viewer.deactivateCode({ promotionCodeId: "promo_1" }).catch((error: unknown) => error),
      ]);

      expect(refusals.map(codeOf)).toEqual(
        refusals.map(() => ({ trpc: "FORBIDDEN", code: "permission_denied" })),
      );
      expect(reached).toEqual(["listCoupons"]);
    });
  });

  describe("when a managing operator creates a coupon", () => {
    it("reaches billing", async () => {
      const reached: string[] = [];
      await couponsDoor(reached)("user-staff")
        .create(REQUEST)
        .catch(() => void 0);

      expect(reached).toEqual(["createCoupon"]);
    });
  });
});
