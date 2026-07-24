import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetForScope = vi.fn().mockResolvedValue(undefined);
const mockListOrganizationRules = vi.fn().mockResolvedValue([]);

vi.mock("../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    dataRetention: {
      policy: {
        setForScope: mockSetForScope,
        listOrganizationRules: mockListOrganizationRules,
      },
    },
  }),
}));

import type { PrismaClient } from "@prisma/client";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_CATEGORIES,
} from "../../../src/server/data-retention/retentionPolicy.schema";
import { LicenseHandler } from "../licenseHandler";
import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import {
  VALID_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
} from "./fixtures/testLicenses";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";

const ORG_ID = "org_123";

const createMockPrisma = () =>
  ({
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: ORG_ID }),
      update: vi.fn().mockResolvedValue({ id: ORG_ID }),
    },
  }) as unknown as PrismaClient;

describe("licenseHandler retention provisioning", () => {
  let handler: LicenseHandler;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrganizationRules.mockResolvedValue([]);
    prisma = createMockPrisma();
    handler = new LicenseHandler({
      prisma,
      publicKey: TEST_PUBLIC_KEY,
      repository: {} as ILicenseEnforcementRepository,
    });
  });

  describe("when a valid license is activated", () => {
    /** @scenario Activating a valid license provisions the missing organization policies */
    it("creates an organization-scoped policy for every category that has none", async () => {
      const result = await handler.validateAndStoreLicense(
        ORG_ID,
        VALID_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      for (const category of RETENTION_CATEGORIES) {
        expect(mockSetForScope).toHaveBeenCalledWith({
          scope: { scopeType: "ORGANIZATION", scopeId: ORG_ID },
          category,
          retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        });
      }
      expect(mockSetForScope).toHaveBeenCalledTimes(RETENTION_CATEGORIES.length);
    });
  });

  describe("when the organization already has an organization-level policy", () => {
    /** @scenario License activation never overrides an existing organization policy */
    it("leaves the existing policy untouched and creates only the missing categories", async () => {
      mockListOrganizationRules.mockResolvedValue([
        {
          scopeType: "ORGANIZATION",
          scopeId: ORG_ID,
          category: "traces",
          retentionDays: 91,
        },
        // PROJECT-scoped row must not count as organization coverage
        {
          scopeType: "PROJECT",
          scopeId: "proj_1",
          category: "scenarios",
          retentionDays: 63,
        },
      ]);

      const result = await handler.validateAndStoreLicense(
        ORG_ID,
        VALID_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      expect(mockSetForScope).not.toHaveBeenCalledWith(
        expect.objectContaining({ category: "traces" }),
      );
      for (const category of ["scenarios", "experiments"]) {
        expect(mockSetForScope).toHaveBeenCalledWith({
          scope: { scopeType: "ORGANIZATION", scopeId: ORG_ID },
          category,
          retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        });
      }
      expect(mockSetForScope).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the license is invalid", () => {
    /** @scenario An invalid license provisions no retention policies */
    it("creates no policies for an expired license", async () => {
      const result = await handler.validateAndStoreLicense(
        ORG_ID,
        EXPIRED_LICENSE_KEY,
      );

      expect(result.success).toBe(false);
      expect(mockSetForScope).not.toHaveBeenCalled();
      expect(mockListOrganizationRules).not.toHaveBeenCalled();
    });
  });

  describe("when retention provisioning fails", () => {
    /** @scenario A retention failure never fails license activation */
    it("still stores the license when listing rules throws", async () => {
      mockListOrganizationRules.mockRejectedValue(
        new Error("retention store down"),
      );

      const result = await handler.validateAndStoreLicense(
        ORG_ID,
        VALID_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      expect(prisma.organization.update).toHaveBeenCalled();
    });

    it("continues to the next category when one upsert throws", async () => {
      mockSetForScope.mockRejectedValueOnce(new Error("retention store down"));

      const result = await handler.validateAndStoreLicense(
        ORG_ID,
        VALID_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      expect(mockSetForScope).toHaveBeenCalledTimes(RETENTION_CATEGORIES.length);
    });
  });
});
