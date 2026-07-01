import type { PlanInfo } from "@ee/licensing/planInfo";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// env.IS_SAAS decides whether the value gate caps at all: self-hosted (!IS_SAAS)
// resolves to enterprise and is never capped. Mutable so each test picks a tier.
const envMock = vi.hoisted(() => ({
  IS_SAAS: true as boolean | undefined,
}));
vi.mock("~/env.mjs", () => ({ env: envMock }));

const planMocks = vi.hoisted(() => ({
  getActivePlan: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: { getActivePlan: planMocks.getActivePlan },
  }),
}));

import {
  assertPlanAllowsRetentionValue,
  assertRetentionWriteAllowed,
} from "../dataRetentionPolicy.authz";

const paidPlan = { free: false, type: "GROWTH_SEAT_EUR_MONTHLY" } as PlanInfo;
const enterprisePlan = { free: false, type: "ENTERPRISE" } as PlanInfo;
const freePlan = { free: true, type: "FREE" } as PlanInfo;

const expectForbidden = (fn: () => void) => {
  expect(fn).toThrow(TRPCError);
  expect(fn).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
};

describe("assertPlanAllowsRetentionValue", () => {
  beforeEach(() => {
    envMock.IS_SAAS = true;
  });

  describe("given a paid (non-enterprise) SaaS plan", () => {
    it.each([35, 63])("allows the fixed preset of %i days", (days) => {
      expect(() =>
        assertPlanAllowsRetentionValue(paidPlan, days),
      ).not.toThrow();
    });

    it("rejects an arbitrary off-menu value (e.g. 364d)", () => {
      expectForbidden(() => assertPlanAllowsRetentionValue(paidPlan, 364));
    });

    it("rejects an enterprise preset like 1 year (371d)", () => {
      expectForbidden(() => assertPlanAllowsRetentionValue(paidPlan, 371));
    });

    it("no-ops on the indefinite sentinel so the admin gate runs downstream", () => {
      expect(() => assertPlanAllowsRetentionValue(paidPlan, 0)).not.toThrow();
    });
  });

  describe("given an enterprise SaaS plan", () => {
    it.each([
      35, 63, 91, 371, 1827,
    ])("allows the enterprise preset of %i days", (days) => {
      expect(() =>
        assertPlanAllowsRetentionValue(enterprisePlan, days),
      ).not.toThrow();
    });

    it("allows a custom value at or above the 49d floor", () => {
      expect(() =>
        assertPlanAllowsRetentionValue(enterprisePlan, 56),
      ).not.toThrow();
    });

    it("rejects a custom value below the 49d floor that isn't a paid preset", () => {
      // 42d is 7-aligned but below the enterprise floor and not 35/63.
      expectForbidden(() => assertPlanAllowsRetentionValue(enterprisePlan, 42));
    });
  });

  describe("given a self-hosted deployment (IS_SAAS unset)", () => {
    beforeEach(() => {
      envMock.IS_SAAS = undefined;
    });

    it("allows a long custom window (2 years) even on a non-enterprise plan type", () => {
      expect(() => assertPlanAllowsRetentionValue(paidPlan, 735)).not.toThrow();
    });

    it("still enforces the 49d floor for sub-floor non-preset values", () => {
      expectForbidden(() => assertPlanAllowsRetentionValue(paidPlan, 42));
    });
  });

  describe("given a free plan (blocked upstream by the free gate)", () => {
    it("does not additionally reject on the value rule", () => {
      expect(() => assertPlanAllowsRetentionValue(freePlan, 371)).not.toThrow();
    });
  });
});

describe("assertRetentionWriteAllowed", () => {
  const ORG_SCOPE = { scopeType: "ORGANIZATION" as const, scopeId: "org_1" };

  function makeCtx() {
    return {
      session: { user: { id: "user_1" } },
      prisma: {
        organization: {
          findUnique: vi.fn().mockResolvedValue({ id: "org_1" }),
        },
      },
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.IS_SAAS = true;
  });

  it("resolves the org and plan exactly once for the whole gate", async () => {
    planMocks.getActivePlan.mockResolvedValue(paidPlan);
    const ctx = makeCtx();
    await assertRetentionWriteAllowed(ctx, ORG_SCOPE, 35);
    expect(ctx.prisma.organization.findUnique).toHaveBeenCalledTimes(1);
    expect(planMocks.getActivePlan).toHaveBeenCalledTimes(1);
  });

  it("rejects a paid org's off-menu value end-to-end", async () => {
    planMocks.getActivePlan.mockResolvedValue(paidPlan);
    await expect(
      assertRetentionWriteAllowed(makeCtx(), ORG_SCOPE, 371),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks a free org via the free gate before the value rule", async () => {
    planMocks.getActivePlan.mockResolvedValue(freePlan);
    await expect(
      assertRetentionWriteAllowed(makeCtx(), ORG_SCOPE, 35),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND when the scope resolves to no organization", async () => {
    const ctx = {
      session: { user: { id: "user_1" } },
      prisma: {
        organization: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    } as any;
    await expect(
      assertRetentionWriteAllowed(ctx, ORG_SCOPE, 35),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(planMocks.getActivePlan).not.toHaveBeenCalled();
  });
});
