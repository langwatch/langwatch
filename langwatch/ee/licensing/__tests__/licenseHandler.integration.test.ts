import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/server/db";
import { LicenseHandler } from "../licenseHandler";
import { OrganizationNotFoundError } from "../errors";
import {
  generateTestLicense,
  generateExpiredTestLicense,
  generateTamperedTestLicense,
} from "./fixtures/generateTestLicense";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import { FREE_PLAN } from "../constants";

describe("LicenseHandler Integration", () => {
  let organizationId: string;
  let handler: LicenseHandler;

  beforeAll(async () => {
    // Create handler with test public key
    handler = new LicenseHandler({
      prisma,
      publicKey: TEST_PUBLIC_KEY,
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
      expect(status.plan).toBeUndefined();
      expect(status.expiresAt).toBeUndefined();
    });

    it("returns valid=true with metadata for valid license", async () => {
      const validLicense = generateTestLicense({
        organizationName: "Test Company",
        plan: { type: "GROWTH", name: "Growth Plan", maxMembers: 25 },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: validLicense },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.plan).toBe("GROWTH");
      expect(status.planName).toBe("Growth Plan");
      expect(status.organizationName).toBe("Test Company");
      expect(status.maxMembers).toBe(25);
      expect(status.expiresAt).toBeDefined();
    });

    it("returns valid=false with metadata for expired license", async () => {
      const expiredLicense = generateExpiredTestLicense({
        organizationName: "Expired Company",
        plan: { type: "PRO", name: "Pro Plan" },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: expiredLicense },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      // Metadata is still returned for UI display (e.g., "license expired" message)
      expect(status.plan).toBe("PRO");
      expect(status.planName).toBe("Pro Plan");
      expect(status.organizationName).toBe("Expired Company");
      expect(status.expiresAt).toBeDefined();
    });

    it("returns valid=false for tampered license", async () => {
      const tamperedLicense = generateTamperedTestLicense({
        organizationName: "Tampered Company",
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: tamperedLicense },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      // Metadata may still be present from parsed data
      expect(status.organizationName).toBe("Tampered Company");
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
      expect(status.plan).toBeUndefined();
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

      const validLicense = generateTestLicense({
        plan: { maxMembers: 10 },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: validLicense },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.currentMembers).toBeGreaterThanOrEqual(1);
      expect(status.maxMembers).toBe(10);

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
      const validLicense = generateTestLicense({
        plan: {
          type: "ENTERPRISE",
          name: "Enterprise",
          maxMembers: 100,
          maxProjects: 999,
          maxMessagesPerMonth: 1_000_000,
          evaluationsCredit: 1000,
          maxWorkflows: 500,
          canPublish: true,
        },
      });

      const result = await handler.validateAndStoreLicense(
        organizationId,
        validLicense
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe("ENTERPRISE");
        expect(result.planInfo.maxMembers).toBe(100);
      }

      // Verify stored in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true, licenseExpiresAt: true, licenseLastValidatedAt: true },
      });

      expect(org?.license).toBe(validLicense);
      expect(org?.licenseExpiresAt).not.toBeNull();
      expect(org?.licenseLastValidatedAt).not.toBeNull();
    });

    it("returns error for invalid license format", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        "garbage-license-data"
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
      const tamperedLicense = generateTamperedTestLicense();

      const result = await handler.validateAndStoreLicense(
        organizationId,
        tamperedLicense
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid signature");
      }
    });

    it("returns error for expired license", async () => {
      const expiredLicense = generateExpiredTestLicense();

      const result = await handler.validateAndStoreLicense(
        organizationId,
        expiredLicense
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("License expired");
      }
    });

    it("throws OrganizationNotFoundError for non-existent org", async () => {
      const validLicense = generateTestLicense();

      await expect(
        handler.validateAndStoreLicense("non-existent-org-id", validLicense)
      ).rejects.toThrow(OrganizationNotFoundError);
    });

    it("updates existing license when storing new one", async () => {
      const firstLicense = generateTestLicense({
        plan: { type: "PRO", maxMembers: 10 },
      });

      await handler.validateAndStoreLicense(organizationId, firstLicense);

      const secondLicense = generateTestLicense({
        plan: { type: "ENTERPRISE", maxMembers: 100 },
      });

      const result = await handler.validateAndStoreLicense(
        organizationId,
        secondLicense
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe("ENTERPRISE");
        expect(result.planInfo.maxMembers).toBe(100);
      }

      // Verify updated in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true },
      });
      expect(org?.license).toBe(secondLicense);
    });
  });

  // ==========================================================================
  // removeLicense Tests
  // ==========================================================================

  describe("removeLicense", () => {
    it("removes existing license and returns removed=true", async () => {
      // First store a license
      const validLicense = generateTestLicense();
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          license: validLicense,
          licenseExpiresAt: new Date(),
          licenseLastValidatedAt: new Date(),
        },
      });

      const result = await handler.removeLicense(organizationId);

      expect(result.removed).toBe(true);

      // Verify cleared in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true, licenseExpiresAt: true, licenseLastValidatedAt: true },
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
      const validLicense = generateTestLicense({
        plan: { type: "GROWTH", name: "Growth", maxMembers: 25 },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: validLicense },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe("GROWTH");
      expect(plan.maxMembers).toBe(25);
    });

    it("returns FREE_PLAN when license is expired", async () => {
      const expiredLicense = generateExpiredTestLicense();

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: expiredLicense },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(FREE_PLAN.type);
    });

    it("returns FREE_PLAN when license is tampered", async () => {
      const tamperedLicense = generateTamperedTestLicense();

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: tamperedLicense },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(FREE_PLAN.type);
    });
  });

});
