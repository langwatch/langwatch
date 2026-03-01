import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCompositePlanProvider } from "../composite-plan-provider";
import type { PlanProvider } from "../plan-provider";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";

vi.mock("~/env.mjs", () => ({
  env: { ADMIN_EMAILS: "admin@langwatch.ai" },
}));

const ENTERPRISE_LICENSE_PLAN: PlanInfo = {
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  overrideAddingLimitations: false,
  maxMembers: 100,
  maxMembersLite: 50,
  maxTeams: 20,
  maxProjects: 50,
  maxMessagesPerMonth: 1_000_000,
  evaluationsCredit: 100_000,
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
  type: "PRO",
  name: "Pro",
  free: false,
  overrideAddingLimitations: false,
  maxMembers: 5,
  maxMembersLite: 3,
  maxTeams: 3,
  maxProjects: 10,
  maxMessagesPerMonth: 50_000,
  evaluationsCredit: 5_000,
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
