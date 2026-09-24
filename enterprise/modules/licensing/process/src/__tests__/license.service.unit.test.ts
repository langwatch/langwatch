import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import { nowInstant, Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type LicenseLogger,
  type LicenseStorage,
  type LicenseRetention,
  type LicenseUsage,
  NodeLicenseCryptographyAdapter,
  type StoredLicense,
} from "../index.ts";
import { LicenseGenerationService } from "../services/license-generation.service.ts";
import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import {
  EXPIRED_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
  VALID_LICENSE_KEY,
} from "../testing.ts";

/** A freshly minted key, bound to one organization or to none. */
function mintLicenseKey(
  options: { organizationId?: string; connectServices?: string[] } = {},
): string {
  return LicenseGenerationService.create(NodeLicenseCryptographyAdapter.create()).generate({
    ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    ...(options.connectServices ? { connectServices: options.connectServices } : {}),
    organizationName: "Acme Corp",
    email: "buyer@acme.com",
    planType: "GROWTH",
    maxMembers: 5,
    privateKey: TEST_PRIVATE_KEY,
  }).licenseKey;
}

const ORGANIZATION_ID = "org_123";

class MemoryLicenseRepository implements LicenseStorage {
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

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    return { licenseKey: this.stored.get(organizationId)?.licenseKey ?? null };
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

class FixedLicenseUsage implements LicenseUsage {
  constructor(private readonly count: number | "unknown" | "unlimited") {}

  async getCurrentMonthCount(): Promise<number | "unknown" | "unlimited"> {
    return this.count;
  }
}

class MemoryLicenseRetention implements LicenseRetention {
  rules: { scopeType: string; scopeId: string; category: string }[] = [];
  readonly written: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }[] = [];
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

class RecordingLicenseLogger implements LicenseLogger {
  readonly errors: { fields: Record<string, unknown>; message: string }[] = [];

  error(fields: Record<string, unknown>, message: string): void {
    this.errors.push({ fields, message });
  }
}

describe("LicenseService", () => {
  let repository: MemoryLicenseRepository;
  let retention: MemoryLicenseRetention;
  let logger: RecordingLicenseLogger;
  let service: LicenseService;

  /** The same service, on a deployment an operator licensed with `LANGWATCH_LICENSE_KEY`. */
  function serviceWithInstanceKey(instanceLicenseKey: string): LicenseService {
    return LicenseService.create({
      repository,
      cryptography: NodeLicenseCryptographyAdapter.create({ publicKey: TEST_PUBLIC_KEY }),
      logger,
      instanceLicenseKey,
    });
  }

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
        now: () => Temporal.Instant.from("2026-01-02T03:04:05.000Z"),
        retention: { categories: ["traces", "scenarios"], defaultDays: 30 },
      }),
    });
  });

  it("uses the open-source baseline when no license is stored", async () => {
    await expect(service.getActivePlan(ORGANIZATION_ID)).resolves.toBe(UNLIMITED_PLAN);
  });

  /** @scenario "Inspect platform access for another feature" */
  it("lets a valid instance license satisfy platform access without listing organizations", async () => {
    const result = await serviceWithInstanceKey(VALID_LICENSE_KEY).inspectPlatformAccess();

    expect(result).toMatchObject({
      allowed: true,
      inspections: [{ source: "instance", valid: true }],
    });
    expect(repository.listCalls).toBe(0);
  });

  /** @scenario "Inspect platform access for another feature" */
  it("scans organization licenses after an invalid instance candidate and accepts a signed expired license", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: Temporal.Instant.from("2000-01-01T00:00:00.000Z"),
      validatedAt: Temporal.Instant.from("1999-01-01T00:00:00.000Z"),
    });

    const result = await serviceWithInstanceKey(TAMPERED_LICENSE_KEY).inspectPlatformAccess();

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

  /** @scenario "One organization's genuine license enables SSO for the whole deployment" */
  it("allows platform access when only the second scanned organization holds a genuine license", async () => {
    repository.organizations.add("org_other");
    repository.stored.set("org_other", {
      licenseKey: TAMPERED_LICENSE_KEY,
      expiresAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
      validatedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    });
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: VALID_LICENSE_KEY,
      expiresAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
      validatedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    });

    const result = await service.inspectPlatformAccess();

    expect(result.allowed).toBe(true);
  });

  /** @scenario "Activate a valid signed license" */
  it("stores a valid signed license before provisioning missing retention", async () => {
    retention.rules = [
      {
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION_ID,
        category: "traces",
      },
    ];

    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: VALID_LICENSE_KEY,
    });

    expect(result.success).toBe(true);
    expect(repository.stored.get(ORGANIZATION_ID)).toMatchObject({
      licenseKey: VALID_LICENSE_KEY,
      validatedAt: Temporal.Instant.from("2026-01-02T03:04:05.000Z"),
    });
    expect(retention.written).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        category: "scenarios",
        retentionDays: 30,
      },
    ]);
  });

  /** @scenario "Reject a license that was not signed by LangWatch" */
  it("rejects invalid licenses without writing", async () => {
    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: TAMPERED_LICENSE_KEY,
    });
    expect(result).toEqual({ success: false, error: "Invalid signature" });
    expect(repository.stored.size).toBe(0);
  });

  /** @scenario "A license activates only on the organization it was issued for" */
  it("refuses a license issued for another organization, and stores nothing", async () => {
    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: mintLicenseKey({ organizationId: "org_someone_else" }),
    });

    expect(result).toEqual({
      success: false,
      error: "License was issued for a different organization",
    });
    expect(repository.stored.size).toBe(0);
  });

  describe("when platform single sign-on is asked about", () => {
    /** @scenario "One organization's genuine license enables SSO for the whole deployment" */
    it("answers licensed when any organization holds a genuine license, and scans once per process", async () => {
      repository.stored.set(ORGANIZATION_ID, {
        licenseKey: EXPIRED_LICENSE_KEY,
        expiresAt: Temporal.Instant.from("2000-01-01T00:00:00.000Z"),
        validatedAt: Temporal.Instant.from("1999-01-01T00:00:00.000Z"),
      });

      await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);
      await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);
      expect(repository.listCalls).toBe(1);
    });

    it("answers unlicensed where no organization holds a genuine license", async () => {
      repository.stored.set(ORGANIZATION_ID, {
        licenseKey: TAMPERED_LICENSE_KEY,
        expiresAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
        validatedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
      });

      await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(false);
    });

    it("counts the deployment's own instance license without scanning", async () => {
      await expect(
        serviceWithInstanceKey(VALID_LICENSE_KEY).isPlatformSsoLicensed({ isSaas: false }),
      ).resolves.toBe(true);
      expect(repository.listCalls).toBe(0);
    });

    it("answers licensed on LangWatch Cloud without scanning", async () => {
      await expect(service.isPlatformSsoLicensed({ isSaas: true })).resolves.toBe(true);
      expect(repository.listCalls).toBe(0);
    });

    it("denies while the scan fails, and scans again on the next ask", async () => {
      const findOrganizationsWithLicense = repository.findOrganizationsWithLicense.bind(repository);
      let failing = true;
      repository.findOrganizationsWithLicense = async () => {
        if (failing) throw new Error("database unreachable");
        return findOrganizationsWithLicense();
      };
      repository.stored.set(ORGANIZATION_ID, {
        licenseKey: VALID_LICENSE_KEY,
        expiresAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
        validatedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
      });

      await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(false);
      failing = false;
      await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);
    });
  });

  /** @scenario "A license activates only on the organization it was issued for" */
  it("activates a license issued for this organization", async () => {
    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: mintLicenseKey({ organizationId: ORGANIZATION_ID }),
    });

    expect(result.success).toBe(true);
    expect(repository.stored.has(ORGANIZATION_ID)).toBe(true);
  });

  /** @scenario "A license minted before the binding existed keeps working" */
  it("still activates a license minted before keys carried an organization", async () => {
    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: mintLicenseKey(),
    });

    expect(result.success).toBe(true);
  });

  /** @scenario "A license activates only on the organization it was issued for" */
  it("does not read a stored license as platform access for another organization", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: mintLicenseKey({ organizationId: "org_someone_else" }),
      expiresAt: Temporal.Instant.from("2030-01-01T00:00:00.000Z"),
      validatedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    });

    const result = await service.inspectPlatformAccess();

    expect(result.allowed).toBe(false);
    expect(result.inspections).toEqual([
      expect.objectContaining({
        source: "organization",
        organizationId: ORGANIZATION_ID,
        valid: false,
        reason: "organization_mismatch",
      }),
    ]);
  });

  it("raises a handled not-found error for an unknown organization", async () => {
    await expect(
      service.validateAndStoreLicense({
        organizationId: "missing",
        licenseKey: VALID_LICENSE_KEY,
      }),
    ).rejects.toMatchObject({ code: "organization_not_found" });
  });

  it("lets a lapsed license step aside on Cloud but preserves its self-hosted plan", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
      validatedAt: Temporal.Instant.fromEpochMilliseconds(0),
    });

    await expect(service.getActivePlan(ORGANIZATION_ID)).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.getSelfHostedPlan(ORGANIZATION_ID)).resolves.toMatchObject({
      type: "PRO",
      maxMembers: 5,
      free: false,
    });
  });

  it("reads a license naming a hosted service as connected, and an offline one as not", async () => {
    const store = (licenseKey: string) =>
      repository.stored.set(ORGANIZATION_ID, {
        licenseKey,
        expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
        validatedAt: Temporal.Instant.fromEpochMilliseconds(0),
      });

    store(mintLicenseKey({ connectServices: ["instant_evals"] }));
    await expect(service.getLicenseStatus(ORGANIZATION_ID)).resolves.toMatchObject({
      valid: true,
      connected: true,
    });

    store(mintLicenseKey());
    await expect(service.getLicenseStatus(ORGANIZATION_ID)).resolves.toMatchObject({
      valid: true,
      connected: false,
    });
  });

  it("reports usage and distinguishes a genuine lapse from a forged one", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: EXPIRED_LICENSE_KEY,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
      validatedAt: Temporal.Instant.fromEpochMilliseconds(0),
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
      service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: VALID_LICENSE_KEY,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(repository.stored.has(ORGANIZATION_ID)).toBe(true);
    expect(logger.errors).toHaveLength(1);
  });

  it("removes a license idempotently", async () => {
    repository.stored.set(ORGANIZATION_ID, {
      licenseKey: VALID_LICENSE_KEY,
      expiresAt: nowInstant(),
      validatedAt: nowInstant(),
    });

    await expect(service.removeLicense(ORGANIZATION_ID)).resolves.toEqual({
      removed: true,
    });
    await expect(service.removeLicense(ORGANIZATION_ID)).resolves.toEqual({
      removed: true,
    });
  });
});
