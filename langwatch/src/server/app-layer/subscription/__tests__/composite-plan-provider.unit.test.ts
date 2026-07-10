import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCompositePlanProvider } from "../composite-plan-provider";
import type { PlanProvider } from "../plan-provider";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";

vi.mock("~/env.mjs", () => ({
  env: { ADMIN_EMAILS: "admin@langwatch.ai" },
}));

const ENTERPRISE_LICENSE_PLAN: PlanInfo = {
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  overrideAddingLimitations: false,
  maxMembers: 100,
  maxMembersLite: 50,
  maxTeams: 20,
  maxProjects: 50,
  maxMessagesPerMonth: 1_000_000,
  maxWorkflows: 100,
  maxPrompts: 100,
  maxEvaluators: 100,
  maxScenarios: 100,
  maxAgents: 100,
  maxExperiments: 100,
  maxOnlineEvaluations: 100,
  maxDatasets: 100,
  maxDashboards: 100,
  maxCustomGraphs: 100,
  maxAutomations: 100,
  canPublish: true,
  usageUnit: "traces",
  prices: { USD: 0, EUR: 0 },
};

const SAAS_PRO_PLAN: PlanInfo = {
  planSource: "subscription",
  type: "PRO",
  name: "Pro",
  free: false,
  overrideAddingLimitations: false,
  maxMembers: 5,
  maxMembersLite: 3,
  maxTeams: 3,
  maxProjects: 10,
  maxMessagesPerMonth: 50_000,
  maxWorkflows: 10,
  maxPrompts: 10,
  maxEvaluators: 10,
  maxScenarios: 10,
  maxAgents: 10,
  maxExperiments: 10,
  maxOnlineEvaluations: 10,
  maxDatasets: 10,
  maxDashboards: 10,
  maxCustomGraphs: 10,
  maxAutomations: 10,
  canPublish: true,
  usageUnit: "traces",
  prices: { USD: 49, EUR: 45 },
};

describe("createCompositePlanProvider", () => {
  let mockLicense: PlanProvider;
  let mockSaas: PlanProvider;

  beforeEach(() => {
    mockLicense = {
      getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN),
    };
    mockSaas = {
      getActivePlan: vi.fn().mockResolvedValue(SAAS_PRO_PLAN),
    };
  });

  describe("when no valid license exists", () => {
    it("selects SaaS plan", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
      });

      expect(plan.type).toBe("PRO");
      expect(plan.maxMessagesPerMonth).toBe(50_000);
    });

    it("passes user to SaaS provider", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const user = { id: "u1", email: "test@example.com" };
      await provider.getActivePlan({ organizationId: "org-1", user });

      expect(mockSaas.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-1",
        user,
      });
    });
  });

  describe("when valid license exists", () => {
    beforeEach(() => {
      vi.mocked(mockLicense.getActivePlan).mockResolvedValue(
        ENTERPRISE_LICENSE_PLAN,
      );
    });

    it("selects license plan over SaaS plan", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
      });

      expect(plan.type).toBe("ENTERPRISE");
      expect(plan.maxMessagesPerMonth).toBe(1_000_000);
    });

    it("does not call SaaS provider", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      await provider.getActivePlan({ organizationId: "org-1" });

      expect(mockSaas.getActivePlan).not.toHaveBeenCalled();
    });
  });

  describe("overrideAddingLimitations", () => {
    it("is false when no user is provided", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
      });

      expect(plan.overrideAddingLimitations).toBe(false);
    });

    it("is false for regular user without impersonator", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
        user: { id: "u1", email: "user@example.com" },
      });

      expect(plan.overrideAddingLimitations).toBe(false);
    });

    it("is true when impersonated by admin", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
        user: {
          id: "u1",
          email: "user@example.com",
          impersonator: { email: "admin@langwatch.ai" },
        },
      });

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("is false when impersonated by non-admin", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
        user: {
          id: "u1",
          email: "user@example.com",
          impersonator: { email: "not-admin@example.com" },
        },
      });

      expect(plan.overrideAddingLimitations).toBe(false);
    });

    it("recomputes override even when license plan is selected", async () => {
      vi.mocked(mockLicense.getActivePlan).mockResolvedValue(
        ENTERPRISE_LICENSE_PLAN,
      );

      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
        user: {
          id: "u1",
          impersonator: { email: "admin@langwatch.ai" },
        },
      });

      // License plan selected (ENTERPRISE), but override recomputed from context
      expect(plan.type).toBe("ENTERPRISE");
      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("does not leak SaaS override value into license plan", async () => {
      // SaaS provider returns plan with override=true
      vi.mocked(mockSaas.getActivePlan).mockResolvedValue({
        ...SAAS_PRO_PLAN,
        overrideAddingLimitations: true,
      });

      // License is valid — composite should select license
      vi.mocked(mockLicense.getActivePlan).mockResolvedValue(
        ENTERPRISE_LICENSE_PLAN,
      );

      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      // No impersonator — override should be false regardless of source
      const plan = await provider.getActivePlan({
        organizationId: "org-1",
        user: { id: "u1", email: "user@example.com" },
      });

      expect(plan.type).toBe("ENTERPRISE");
      expect(plan.overrideAddingLimitations).toBe(false);
    });
  });

  describe("select-one completeness", () => {
    it("returns all fields from the selected license plan", async () => {
      vi.mocked(mockLicense.getActivePlan).mockResolvedValue(
        ENTERPRISE_LICENSE_PLAN,
      );

      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
      });

      // Verify no field mixing — all values come from license plan
      expect(plan.maxMembers).toBe(ENTERPRISE_LICENSE_PLAN.maxMembers);
      expect(plan.maxProjects).toBe(ENTERPRISE_LICENSE_PLAN.maxProjects);
      expect(plan.prices).toEqual(ENTERPRISE_LICENSE_PLAN.prices);
      expect(plan.canPublish).toBe(ENTERPRISE_LICENSE_PLAN.canPublish);
    });

    it("returns all fields from the selected SaaS plan", async () => {
      const provider = createCompositePlanProvider({
        licensePlanProvider: mockLicense,
        saasPlanProvider: mockSaas,
      });

      const plan = await provider.getActivePlan({
        organizationId: "org-1",
      });

      expect(plan.maxMembers).toBe(SAAS_PRO_PLAN.maxMembers);
      expect(plan.maxProjects).toBe(SAAS_PRO_PLAN.maxProjects);
      expect(plan.prices).toEqual(SAAS_PRO_PLAN.prices);
      expect(plan.canPublish).toBe(SAAS_PRO_PLAN.canPublish);
    });
  });
});

describe("createCompositePlanProvider — precedence rank (ADR-039)", () => {
  const GROWTH_LICENSE_PLAN: PlanInfo = {
    ...ENTERPRISE_LICENSE_PLAN,
    type: "GROWTH",
    name: "Growth",
    maxMembers: 6,
  };
  const SEAT_SUBSCRIPTION_PLAN: PlanInfo = {
    ...SAAS_PRO_PLAN,
    type: "GROWTH_SEAT_EUR_MONTHLY",
    name: "Growth",
  };
  const FREE_SAAS_PLAN: PlanInfo = { ...FREE_PLAN };

  function makeProvider({
    licensePlan,
    saasPlan,
    rankEnabled,
  }: {
    licensePlan: PlanInfo;
    saasPlan: PlanInfo;
    rankEnabled: boolean;
  }) {
    return createCompositePlanProvider({
      licensePlanProvider: {
        getActivePlan: vi.fn().mockResolvedValue(licensePlan),
      },
      saasPlanProvider: { getActivePlan: vi.fn().mockResolvedValue(saasPlan) },
      isPrecedenceRankEnabled: vi.fn().mockResolvedValue(rankEnabled),
    });
  }

  describe("when the precedence flag is disabled", () => {
    /** @scenario With the flag disabled a valid license still beats an active subscription */
    it("selects the license over an active subscription", async () => {
      const provider = makeProvider({
        licensePlan: GROWTH_LICENSE_PLAN,
        saasPlan: SEAT_SUBSCRIPTION_PLAN,
        rankEnabled: false,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("license");
    });
  });

  describe("when the precedence flag is enabled", () => {
    /** @scenario An active subscription outranks a non-ENTERPRISE license */
    it("selects the active subscription over a GROWTH license", async () => {
      const provider = makeProvider({
        licensePlan: GROWTH_LICENSE_PLAN,
        saasPlan: SEAT_SUBSCRIPTION_PLAN,
        rankEnabled: true,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("subscription");
      expect(plan.type).toBe("GROWTH_SEAT_EUR_MONTHLY");
    });

    /** @scenario An ENTERPRISE license outranks an active subscription */
    it("selects the ENTERPRISE license over an active subscription", async () => {
      const provider = makeProvider({
        licensePlan: ENTERPRISE_LICENSE_PLAN,
        saasPlan: SEAT_SUBSCRIPTION_PLAN,
        rankEnabled: true,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("license");
      expect(plan.type).toBe("ENTERPRISE");
    });

    /** @scenario A non-ENTERPRISE license outranks having no subscription */
    it("selects the license when the org has no paid subscription", async () => {
      const provider = makeProvider({
        licensePlan: GROWTH_LICENSE_PLAN,
        saasPlan: FREE_SAAS_PLAN,
        rankEnabled: true,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("license");
      expect(plan.type).toBe("GROWTH");
    });

    /** @scenario An expired license never wins the rank */
    it("selects the subscription when the license resolves free (expired)", async () => {
      const provider = makeProvider({
        licensePlan: FREE_PLAN,
        saasPlan: SEAT_SUBSCRIPTION_PLAN,
        rankEnabled: true,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("subscription");
    });

    it("resolves free when neither source is paid", async () => {
      const provider = makeProvider({
        licensePlan: FREE_PLAN,
        saasPlan: FREE_SAAS_PLAN,
        rankEnabled: true,
      });

      const plan = await provider.getActivePlan({ organizationId: "org-1" });

      expect(plan.planSource).toBe("free");
      expect(plan.free).toBe(true);
    });
  });
});
