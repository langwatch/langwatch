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

import { assertRetentionValueAllowedForPlan } from "../dataRetentionPolicy.authz";

const ORG_SCOPE = { scopeType: "ORGANIZATION" as const, scopeId: "org_1" };

/** ctx whose prisma resolves the org scope to org_1 (so the gate reaches the
 *  plan lookup). Session carries a user for the plan-provider call. */
function makeCtx() {
  return {
    session: { user: { id: "user_1" } },
    prisma: {
      organization: { findUnique: vi.fn().mockResolvedValue({ id: "org_1" }) },
    },
  } as any;
}

function mockPlan(plan: { free: boolean; type: string }) {
  planMocks.getActivePlan.mockResolvedValue(plan);
}

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
}

describe("assertRetentionValueAllowedForPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.IS_SAAS = true;
  });

  describe("given a paid (non-enterprise) SaaS org", () => {
    beforeEach(() => {
      mockPlan({ free: false, type: "GROWTH_SEAT_EUR_MONTHLY" });
    });

    it("allows the fixed 1-month preset (35d)", async () => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 35),
      ).resolves.toBeUndefined();
    });

    it("allows the fixed 2-month preset (63d)", async () => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 63),
      ).resolves.toBeUndefined();
    });

    it("rejects an arbitrary off-menu value (e.g. 364d)", async () => {
      await expectForbidden(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 364),
      );
    });

    it("rejects an enterprise preset like 1 year (371d)", async () => {
      await expectForbidden(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 371),
      );
    });

    it("no-ops on the indefinite sentinel so the admin gate runs downstream", async () => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 0),
      ).resolves.toBeUndefined();
    });
  });

  describe("given an enterprise SaaS org", () => {
    beforeEach(() => {
      mockPlan({ free: false, type: "ENTERPRISE" });
    });

    it.each([
      35, 63, 91, 371, 1827,
    ])("allows the enterprise preset %id", async (days) => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, days),
      ).resolves.toBeUndefined();
    });

    it("allows a custom value at or above the 49d floor", async () => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 56),
      ).resolves.toBeUndefined();
    });

    it("rejects a custom value below the 49d floor that isn't a paid preset", async () => {
      // 42d is 7-aligned but below the enterprise floor and not 35/63.
      await expectForbidden(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 42),
      );
    });
  });

  describe("given a self-hosted deployment (IS_SAAS unset)", () => {
    beforeEach(() => {
      envMock.IS_SAAS = undefined;
      // A self-hosted plan may report any type; the gate must not cap it.
      mockPlan({ free: false, type: "GROWTH_SEAT_EUR_MONTHLY" });
    });

    it("allows a long custom window (2 years)", async () => {
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 735),
      ).resolves.toBeUndefined();
    });

    it("still enforces the 49d floor for sub-floor non-preset values", async () => {
      await expectForbidden(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 42),
      );
    });
  });

  describe("given a free org (blocked upstream by the free gate)", () => {
    it("does not additionally reject on the value rule", async () => {
      mockPlan({ free: true, type: "FREE" });
      await expect(
        assertRetentionValueAllowedForPlan(makeCtx(), ORG_SCOPE, 371),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a scope that resolves to no organization", () => {
    it("throws NOT_FOUND before consulting the plan", async () => {
      const ctx = {
        session: { user: { id: "user_1" } },
        prisma: {
          organization: { findUnique: vi.fn().mockResolvedValue(null) },
        },
      } as any;
      await expect(
        assertRetentionValueAllowedForPlan(ctx, ORG_SCOPE, 35),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(planMocks.getActivePlan).not.toHaveBeenCalled();
    });
  });
});
