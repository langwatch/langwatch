import { beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "~/server/utils/ttlCache";
import type { PlanResolver } from "../../subscription/plan-provider";
import type { OrganizationService } from "../../organizations/organization.service";
import { UsageService } from "../usage.service";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { PricingModel } from "@prisma/client";

vi.mock("~/env.mjs", () => ({
  env: { IS_SAAS: true },
}));

vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

vi.mock("../../../clickhouse/clickhouseClient", () => ({
  isClickHouseEnabled: () => false,
  getClickHouseClientForProject: () => Promise.resolve(null),
}));

const PAID_TIERED_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "subscription",
  type: "PRO",
  name: "Pro",
  free: false,
  maxMessagesPerMonth: 10_000,
};

const LICENSE_TRACES_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMessagesPerMonth: 100_000,
  usageUnit: "traces",
};

describe("UsageService.getResolvedUsageUnit", () => {
  const mockOrgService = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
  } as unknown as OrganizationService;

  const mockTraceUsageService = { getCountByProjects: vi.fn() };
  const mockEventUsageService = {
    getCountByProjects: vi.fn(),
    getCurrentMonthCount: vi.fn(),
  };
  const mockOrgRepo = {
    getPricingModel: vi.fn().mockResolvedValue(null),
  };
  const mockPlanResolver = vi.fn() as unknown as PlanResolver;

  let service: UsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgRepo.getPricingModel.mockResolvedValue(PricingModel.TIERED);
    service = Object.create(UsageService.prototype);
    Object.assign(service, {
      organizationService: mockOrgService,
      traceUsageService: mockTraceUsageService,
      eventUsageService: mockEventUsageService,
      planResolver: mockPlanResolver,
      organizationRepository: mockOrgRepo,
      cache: new TtlCache<number>(30_000, "test:"),
      decisionCache: new TtlCache<unknown>(30_000, "test:"),
    });
  });

  describe("when free TIERED organization", () => {
    it("returns events", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...FREE_PLAN,
      });

      const unit = await service.getResolvedUsageUnit({
        organizationId: "org-free",
      });

      expect(unit).toBe("events");
    });
  });

  describe("when paid TIERED organization", () => {
    it("returns traces", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...PAID_TIERED_PLAN,
      });

      const unit = await service.getResolvedUsageUnit({
        organizationId: "org-paid",
      });

      expect(unit).toBe("traces");
    });
  });

  describe("when licensed organization specifies trace-based counting", () => {
    it("returns the license-specified usage unit", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...LICENSE_TRACES_PLAN,
      });

      const unit = await service.getResolvedUsageUnit({
        organizationId: "org-license",
      });

      expect(unit).toBe("traces");
    });
  });
});
