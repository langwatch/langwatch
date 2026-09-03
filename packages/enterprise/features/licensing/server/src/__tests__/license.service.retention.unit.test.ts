import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LicenseRetentionPort,
  LicenseService,
  LicenseServiceConfiguration,
  LicenseStoragePort,
  NodeLicenseCryptographyAdapter,
  type StoredLicense,
} from "../index";
import { EXPIRED_LICENSE_KEY, TEST_PUBLIC_KEY, VALID_LICENSE_KEY } from "../testing";

const ORGANIZATION_ID = "org_123";
const RETENTION_CATEGORIES = ["traces", "scenarios", "experiments"] as const;
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

class MemoryLicenseRepository extends LicenseStoragePort {
  readonly organizations = new Set([ORGANIZATION_ID]);
  readonly stored = new Map<string, StoredLicense>();

  async findOrganizationsWithLicense() {
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
    return 3;
  }

  async getMembersLiteCount(): Promise<number> {
    return 2;
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
    if (this.failListing) throw new Error("retention store down");
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

describe("LicenseService retention provisioning", () => {
  let repository: MemoryLicenseRepository;
  let retention: MemoryLicenseRetention;
  let service: LicenseService;

  beforeEach(() => {
    repository = new MemoryLicenseRepository();
    retention = new MemoryLicenseRetention();
    service = LicenseService.create({
      repository,
      cryptography: NodeLicenseCryptographyAdapter.create({
        publicKey: TEST_PUBLIC_KEY,
      }),
      retention,
      configuration: LicenseServiceConfiguration.create({
        retention: {
          categories: RETENTION_CATEGORIES,
          defaultDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        },
      }),
    });
  });

  describe("when a valid license is activated", () => {
    /** @scenario Activating a valid license provisions the missing organization policies */
    it("creates an organization-scoped policy for every category that has none", async () => {
      const result = await service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: VALID_LICENSE_KEY,
      });

      expect(result.success).toBe(true);
      for (const category of RETENTION_CATEGORIES) {
        expect(retention.written).toContainEqual({
          organizationId: ORGANIZATION_ID,
          category,
          retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        });
      }
      expect(retention.written).toHaveLength(RETENTION_CATEGORIES.length);
    });
  });

  describe("when the organization already has an organization-level policy", () => {
    /** @scenario License activation never overrides an existing organization policy */
    it("leaves the existing policy untouched and creates only the missing categories", async () => {
      retention.rules = [
        {
          scopeType: "ORGANIZATION",
          scopeId: ORGANIZATION_ID,
          category: "traces",
        },
        // PROJECT-scoped row must not count as organization coverage
        {
          scopeType: "PROJECT",
          scopeId: "proj_1",
          category: "scenarios",
        },
      ];

      const result = await service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: VALID_LICENSE_KEY,
      });

      expect(result.success).toBe(true);
      expect(retention.written).not.toContainEqual(expect.objectContaining({ category: "traces" }));
      for (const category of ["scenarios", "experiments"]) {
        expect(retention.written).toContainEqual({
          organizationId: ORGANIZATION_ID,
          category,
          retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        });
      }
      expect(retention.written).toHaveLength(2);
    });
  });

  describe("when the license is invalid", () => {
    /** @scenario An invalid license provisions no retention policies */
    it("creates no policies for an expired license", async () => {
      const result = await service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: EXPIRED_LICENSE_KEY,
      });

      expect(result.success).toBe(false);
      expect(retention.written).toHaveLength(0);
    });
  });

  describe("when retention provisioning fails", () => {
    /** @scenario A retention failure never fails license activation */
    it("still stores the license when listing rules throws", async () => {
      retention.failListing = true;

      const result = await service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: VALID_LICENSE_KEY,
      });

      expect(result.success).toBe(true);
      expect(repository.stored.has(ORGANIZATION_ID)).toBe(true);
    });

    it("continues to the next category when one upsert throws", async () => {
      const setForOrganization = vi.spyOn(retention, "setForOrganization");
      setForOrganization.mockRejectedValueOnce(new Error("retention store down"));

      const result = await service.validateAndStoreLicense({
        organizationId: ORGANIZATION_ID,
        licenseKey: VALID_LICENSE_KEY,
      });

      expect(result.success).toBe(true);
      expect(setForOrganization).toHaveBeenCalledTimes(RETENTION_CATEGORIES.length);
    });
  });
});
