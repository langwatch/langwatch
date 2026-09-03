import {
  LICENSE_ERRORS,
  LicensingService,
  type PlanInfo,
  UNLIMITED_PLAN,
} from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it, vi } from "vitest";
import { LicensingEntitlementSource } from "../index";

const paidLicense: PlanInfo = {
  ...UNLIMITED_PLAN,
  planSource: "license" as const,
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMessagesPerMonth: 100,
  canPublish: false,
};

class StubLicensingService extends LicensingService {
  readonly getActivePlan = vi.fn(async (_organizationId: string) => this.cloud);
  readonly getSelfHostedPlan = vi.fn(async (_organizationId: string) => this.selfHosted);

  constructor(
    private readonly cloud: PlanInfo,
    private readonly selfHosted: PlanInfo,
  ) {
    super();
  }

  async inspectPlatformAccess() {
    return { allowed: false, inspections: [] };
  }

  async validateAndStoreLicense() {
    return { success: false as const, error: LICENSE_ERRORS.INVALID_FORMAT };
  }

  async getLicenseStatus() {
    return { hasLicense: false as const, valid: false as const };
  }

  async removeLicense() {
    return { removed: true as const };
  }
}

function licensingFor({
  cloud = UNLIMITED_PLAN,
  selfHosted = UNLIMITED_PLAN,
}: {
  cloud?: PlanInfo;
  selfHosted?: PlanInfo;
} = {}): StubLicensingService {
  return new StubLicensingService(cloud, selfHosted);
}

describe("LicensingEntitlementSource", () => {
  it("lets an expired Cloud license step aside for the next entitlement source", async () => {
    const licensing = licensingFor();
    const source = LicensingEntitlementSource.create({ licensing, mode: "cloud" });

    await expect(source.resolve({ organizationId: "organization-1" })).resolves.toBe(
      UNLIMITED_PLAN,
    );
    expect(licensing.getSelfHostedPlan).not.toHaveBeenCalled();
  });

  it("preserves a genuine lapsed self-hosted license and applies its OSS floor", async () => {
    const licensing = licensingFor({ selfHosted: paidLicense });
    const source = LicensingEntitlementSource.create({ licensing, mode: "self-hosted" });

    await expect(source.resolve({ organizationId: "organization-1" })).resolves.toMatchObject({
      type: "ENTERPRISE",
      free: false,
      maxMembers: 10,
      maxMessagesPerMonth: UNLIMITED_PLAN.maxMessagesPerMonth,
      canPublish: true,
    });
    expect(licensing.getActivePlan).not.toHaveBeenCalled();
  });
});
