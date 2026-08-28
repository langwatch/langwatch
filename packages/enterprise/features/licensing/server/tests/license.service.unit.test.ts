import { beforeEach, describe, expect, it } from "vitest";
import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import {
  LicenseLoggerPort,
  LicenseStoragePort,
  LicenseRetentionPort,
  LicenseService,
  LicenseServiceConfiguration,
  LicenseUsagePort,
  NodeLicenseCryptographyAdapter,
  type StoredLicense,
} from "../src";
import {
  EXPIRED_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  TEST_PUBLIC_KEY,
  VALID_LICENSE_KEY,
} from "../src/testing";

const ORGANIZATION_ID = "org_123";

class MemoryLicenseRepository extends LicenseStoragePort {
  readonly organizations = new Set([ORGANIZATION_ID]);
  readonly stored = new Map<string, StoredLicense>();
  memberCount = 3;
  membersLiteCount = 2;
  listCalls = 0;

  async findOrganizationsWithLicense() {
    this.listCalls++;
    return [...this.stored].map(([organizationId, license]) => ({
      organizationId,
      licenseKey: license.licenseKey,
    }));
  }

  async tryReadLicense(organizationId: string): Promise<string | null> {
    return this.stored.get(organizationId)?.licenseKey ?? null;
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async storeLicense(organizationId: string, license: StoredLicense): Promise<void> {
    this.stored.set(organizationId, license);
  }

  async removeLicense(organizationId: string): Promise<void> {
    this.stored.delete(organizationId);
  }

  async getMemberCount(): Promise<number> {
    return this.memberCount;
  }

  async getMembersLiteCount(): Promise<number> {
    return this.membersLiteCount;
  }
}

class FixedLicenseUsage extends LicenseUsagePort {
  constructor(private readonly count: number | "unknown" | "unlimited") {
    super();
  }

  async getCurrentMonthCount(): Promise<number | "unknown" | "unlimited"> {
    return this.count;
  }
}

class MemoryLicenseRetention extends LicenseRetentionPort {
  rules: Array<{ scopeType: string; scopeId: string; category: string }> = [];
  readonly written: Array<{
    organizationId: string;
    category: string;
    retentionDays: number;
  }> = [];
  failListing = false;

  async listOrganizationRules() {
    if (this.failListing) throw new Error("retention unavailable");
    return this.rules;
  }

  async setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void> {
    this.written.push(input);
  }
}

class RecordingLicenseLogger extends LicenseLoggerPort {
  readonly errors: Array<{ fields: Record<string, unknown>; message: string }> = [];

  error(fields: Record<string, unknown>, message: string): void {
    this.errors.push({ fields, message });
  }
}

describe("LicenseService", () => {
  let repository: MemoryLicenseRepository;
  let retention: MemoryLicenseRetention;
  let logger: RecordingLicenseLogger;
  let service: LicenseService;

  beforeEach(() => {
    repository = new MemoryLicenseRepository();
    retention = new MemoryLicenseRetention();
    logger = new RecordingLicenseLogger();
    service = LicenseService.create({
      repository,
      cryptography: NodeLicenseCryptographyAdapter.create({
        publicKey: TEST_PUBLIC_KEY,
      }),
      usage: new FixedLicenseUsage(42),
      retention,
      logger,
      configuration: LicenseServiceConfiguration.create({
        now: () => new Date("2026-01-02T03:04:05.000Z"),
        retention: { categories: ["traces", "scenarios"], defaultDays: 30 },
      }),
    });
  });

  it("uses the open-source baseline when no license is stored", async () => {
    await expect(service.getActivePlan(ORGANIZATION_ID)).resolves.toBe(UNLIMITED_PLAN);
  });

  it("lets a valid instance license satisfy platform access without listing organizations", async () => {
    const result = await service.inspectPlatformAccess({
      instanceLicenseKey: VALID_LICENSE_KEY,
    });

    expect(result).toMatchObject({
      allowed: true,
      inspections: [{ source: "instance", valid: true }],
    });
    expect(repository.listCalls).toBe(0);
  });

  it("scans organization licenses after an invalid instance candidate and accepts a signed expired license", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      validatedAt: new Date("1999-01-01T00:00:00.000Z"),
    });

    const result = await service.inspectPlatformAccess({
      instanceLicenseKey: TAMPERED_LICENSE_KEY,
    });

    expect(result.allowed).toBe(true);
    expect(result.inspections).toEqual([
      expect.objectContaining({
        source: "instance",
        valid: false,
        reason: "invalid_signature",
      }),
      expect.objectContaining({
        source: "organization",
        organizationId: ORGANIZATION_ID,
        valid: true,
        expired: true,
      }),
    ]);
    expect(repository.listCalls).toBe(1);
  });

  it("stores a valid signed license before provisioning missing retention", async () => {
    retention.rules = [
      {
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION_ID,
        category: "traces",
      },
    ];

    const result = await service.validateAndStoreLicense(
      ORGANIZATION_ID,
      VALID_LICENSE_KEY,
    );

    expect(result.success).toBe(true);
    expect(repository.stored.get(ORGANIZATION_ID)).toMatchObject({
      licenseKey: VALID_LICENSE_KEY,
      validatedAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(retention.written).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        category: "scenarios",
        retentionDays: 30,
      },
    ]);
  });

  it("rejects invalid licenses without writing", async () => {
    const result = await service.validateAndStoreLicense(
      ORGANIZATION_ID,
      TAMPERED_LICENSE_KEY,
    );
    expect(result).toEqual({ success: false, error: "Invalid signature" });
    expect(repository.stored.size).toBe(0);
  });

  it("raises a handled not-found error for an unknown organization", async () => {
    await expect(
      service.validateAndStoreLicense("missing", VALID_LICENSE_KEY),
    ).rejects.toMatchObject({ code: "organization_not_found" });
  });

  it("lets a lapsed license step aside on Cloud but preserves its self-hosted plan", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: new Date(0),
      validatedAt: new Date(0),
    });

    await expect(service.getActivePlan(ORGANIZATION_ID)).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.getSelfHostedPlan(ORGANIZATION_ID)).resolves.toMatchObject({
      type: "PRO",
      maxMembers: 5,
      free: false,
    });
  });

  it("reports usage and distinguishes a genuine lapse from a forged one", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: new Date(0),
      validatedAt: new Date(0),
    });

    await expect(service.getLicenseStatus(ORGANIZATION_ID)).resolves.toMatchObject({
      hasLicense: true,
      valid: false,
      expired: true,
      currentMembers: 3,
      currentMembersLite: 2,
      currentMessagesPerMonth: 42,
    });
  });

  it("keeps activation successful when best-effort retention fails", async () => {
    retention.failListing = true;

    await expect(
      service.validateAndStoreLicense(ORGANIZATION_ID, VALID_LICENSE_KEY),
    ).resolves.toMatchObject({ success: true });
    expect(repository.stored.has(ORGANIZATION_ID)).toBe(true);
    expect(logger.errors).toHaveLength(1);
  });

  it("removes a license idempotently", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: VALID_LICENSE_KEY,
      expiresAt: new Date(),
      validatedAt: new Date(),
    });

    await expect(service.removeLicense(ORGANIZATION_ID)).resolves.toEqual({
      removed: true,
    });
    await expect(service.removeLicense(ORGANIZATION_ID)).resolves.toEqual({
      removed: true,
    });
  });
});
