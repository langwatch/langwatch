import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import {
  EXPIRED_LICENSE_KEY,
  MemoryLicenseStorage,
  RecordingLicenseRetention,
  TEST_PUBLIC_KEY,
  VALID_LICENSE_KEY,
} from "./testing.ts";

const ORGANIZATION_ID = "org_123";
const RETENTION_CATEGORIES = ["traces", "scenarios", "experiments"] as const;
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

describe("LicenseService retention provisioning", () => {
  let repository: MemoryLicenseStorage;
  let retention: RecordingLicenseRetention;
  let service: LicenseService;

  beforeEach(() => {
    repository = MemoryLicenseStorage.create({
      organizations: [ORGANIZATION_ID],
      memberCount: 3,
      membersLiteCount: 2,
    });
    retention = new RecordingLicenseRetention();
    service = LicenseService.create({
      repository,
      cryptography: NodeLicenseCryptographyService.create({
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
