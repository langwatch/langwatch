import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import { prisma } from "../../../src/server/db";
import { LicenseHandler, type ITraceUsageService } from "../licenseHandler";
import { OrganizationNotFoundError } from "../errors";
import {
  BASE_LICENSE,
  ENTERPRISE_LICENSE,
  VALID_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  ENTERPRISE_LICENSE_KEY,
  GARBAGE_DATA,
} from "./fixtures/testLicenses";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import { FREE_PLAN } from "../constants";
import { LicenseEnforcementRepository } from "../../../src/server/license-enforcement/license-enforcement.repository";

// Mock TraceUsageService for testing - returns 0 for all counts
const mockTraceUsageService: ITraceUsageService = {
  getCurrentMonthCount: async () => 0,
};

describe("LicenseHandler Integration", () => {
  let organizationId: string;
  let handler: LicenseHandler;

  beforeAll(async () => {
    // Create handler with test public key, repository, and trace service
    handler = new LicenseHandler({
      prisma,
      publicKey: TEST_PUBLIC_KEY,
      repository: new LicenseEnforcementRepository(prisma),
      traceUsageService: mockTraceUsageService,
    });

    // Create test organization
    const organization = await prisma.organization.upsert({
      where: { slug: "license-handler-test-org" },
      update: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
      create: {
        name: "License Handler Test Org",
        slug: "license-handler-test-org",
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.organization.deleteMany({
      where: { slug: "license-handler-test-org" },
    });
  });

  afterEach(async () => {
    // Reset license after each test
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  });

  // ==========================================================================
  // getLicenseStatus Tests
  // ==========================================================================

  describe("getLicenseStatus", () => {
    it("returns hasLicense=false when org has no license", async () => {
      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(false);
      expect(status.valid).toBe(false);
      expect("plan" in status).toBe(false);
      expect("expiresAt" in status).toBe(false);
    });

    it("returns valid=true with metadata for valid license", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: VALID_LICENSE_KEY },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(true);
      if (!status.hasLicense || !("plan" in status)) {
        throw new Error("Expected license with plan metadata");
      }
      expect(status.plan).toBe(BASE_LICENSE.plan.type);
      expect(status.planName).toBe(BASE_LICENSE.plan.name);
      expect(status.organizationName).toBe(BASE_LICENSE.organizationName);
      expect(status.maxMembers).toBe(BASE_LICENSE.plan.maxMembers);
      expect(status.expiresAt).toBeDefined();
    });

    it("returns valid=false with metadata for expired license", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: EXPIRED_LICENSE_KEY },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      // Metadata is still returned for UI display (e.g., "license expired" message)
      if (!status.hasLicense || !("plan" in status)) {
        throw new Error("Expected license with plan metadata");
      }
      expect(status.plan).toBe(BASE_LICENSE.plan.type);
      expect(status.planName).toBe(BASE_LICENSE.plan.name);
      expect(status.organizationName).toBe(BASE_LICENSE.organizationName);
      expect(status.expiresAt).toBeDefined();
    });

    it("returns valid=false for tampered license", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: TAMPERED_LICENSE_KEY },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      // Metadata may still be present from parsed data (tampered has "Hacker Corp")
      if (!status.hasLicense || !("organizationName" in status)) {
        throw new Error("Expected license with organizationName metadata");
      }
      expect(status.organizationName).toBe("Hacker Corp");
    });

    it("returns valid=false for malformed license string", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: "not-a-valid-license-string" },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      // No metadata when format is completely invalid
      expect("plan" in status).toBe(false);
    });

    it("includes current member count in status", async () => {
      // Add a member to the organization
      const user = await prisma.user.create({
        data: {
          email: `test-member-${Date.now()}@example.com`,
          name: "Test Member",
        },
      });

      await prisma.organizationUser.create({
        data: {
          organizationId,
          userId: user.id,
          role: "MEMBER",
        },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: VALID_LICENSE_KEY },
      });

      const status = await handler.getLicenseStatus(organizationId);

      if (!status.hasLicense || !("currentMembers" in status)) {
        throw new Error("Expected license with member count metadata");
      }
      expect(status.currentMembers).toBeGreaterThanOrEqual(1);
      expect(status.maxMembers).toBe(BASE_LICENSE.plan.maxMembers);

      // Cleanup member
      await prisma.organizationUser.deleteMany({
        where: { organizationId, userId: user.id },
      });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  // ==========================================================================
  // validateAndStoreLicense Tests
  // ==========================================================================

  describe("validateAndStoreLicense", () => {
    it("stores valid license and returns success with planInfo", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        ENTERPRISE_LICENSE_KEY
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe(ENTERPRISE_LICENSE.plan.type);
        expect(result.planInfo.maxMembers).toBe(
          ENTERPRISE_LICENSE.plan.maxMembers
        );
      }

      // Verify stored in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          license: true,
          licenseExpiresAt: true,
          licenseLastValidatedAt: true,
        },
      });

      expect(org?.license).toBe(ENTERPRISE_LICENSE_KEY);
      expect(org?.licenseExpiresAt).not.toBeNull();
      expect(org?.licenseLastValidatedAt).not.toBeNull();
    });

    it("returns error for invalid license format", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        GARBAGE_DATA
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid license format");
      }

      // Verify not stored
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true },
      });
      expect(org?.license).toBeNull();
    });

    it("returns error for invalid signature", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        TAMPERED_LICENSE_KEY
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid signature");
      }
    });

    it("returns error for expired license", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        EXPIRED_LICENSE_KEY
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("License expired");
      }
    });

    it("throws OrganizationNotFoundError for non-existent org", async () => {
      await expect(
        handler.validateAndStoreLicense("non-existent-org-id", VALID_LICENSE_KEY)
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it("updates existing license when storing new one", async () => {
      // First store PRO license
      await handler.validateAndStoreLicense(organizationId, VALID_LICENSE_KEY);

      // Then store ENTERPRISE license
      const result = await handler.validateAndStoreLicense(
        organizationId,
        ENTERPRISE_LICENSE_KEY
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe(ENTERPRISE_LICENSE.plan.type);
        expect(result.planInfo.maxMembers).toBe(
          ENTERPRISE_LICENSE.plan.maxMembers
        );
      }

      // Verify updated in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true },
      });
      expect(org?.license).toBe(ENTERPRISE_LICENSE_KEY);
    });
  });

  // ==========================================================================
  // removeLicense Tests
  // ==========================================================================

  describe("removeLicense", () => {
    it("removes existing license and returns removed=true", async () => {
      // First store a license
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          license: VALID_LICENSE_KEY,
          licenseExpiresAt: new Date(),
          licenseLastValidatedAt: new Date(),
        },
      });

      const result = await handler.removeLicense(organizationId);

      expect(result.removed).toBe(true);

      // Verify cleared in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          license: true,
          licenseExpiresAt: true,
          licenseLastValidatedAt: true,
        },
      });

      expect(org?.license).toBeNull();
      expect(org?.licenseExpiresAt).toBeNull();
      expect(org?.licenseLastValidatedAt).toBeNull();
    });

    it("is idempotent - removing when no license exists returns removed=true", async () => {
      // Ensure no license
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: null },
      });

      const result = await handler.removeLicense(organizationId);

      expect(result.removed).toBe(true);
    });

    it("throws OrganizationNotFoundError for non-existent org", async () => {
      await expect(
        handler.removeLicense("non-existent-org-id")
      ).rejects.toThrow(OrganizationNotFoundError);
    });
  });

  // ==========================================================================
  // getActivePlan Tests (ensuring no regression)
  // ==========================================================================

  describe("getActivePlan", () => {
    it("returns FREE_PLAN when no license exists", async () => {
      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(FREE_PLAN.type);
      expect(plan.maxMembers).toBe(FREE_PLAN.maxMembers);
    });

    it("returns license plan when valid license exists", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: ENTERPRISE_LICENSE_KEY },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(ENTERPRISE_LICENSE.plan.type);
      expect(plan.maxMembers).toBe(ENTERPRISE_LICENSE.plan.maxMembers);
    });

    it("returns FREE_PLAN when license is expired", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: EXPIRED_LICENSE_KEY },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(FREE_PLAN.type);
    });

    it("returns FREE_PLAN when license is tampered", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: TAMPERED_LICENSE_KEY },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(FREE_PLAN.type);
    });
  });
});
