import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isEnterpriseTier } from "../../../src/server/api/enterprise";
import { prisma } from "../../../src/server/db";
import { LicenseEnforcementRepository } from "../../../src/server/license-enforcement/license-enforcement.repository";
import { UNLIMITED_PLAN } from "../constants";
import { type ITraceUsageService, LicenseHandler } from "../licenseHandler";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import {
  BASE_LICENSE,
  ENTERPRISE_LICENSE,
  ENTERPRISE_LICENSE_KEY,
  EXPIRED_ENTERPRISE_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  FORGED_EXPIRED_LICENSE_KEY,
  GARBAGE_DATA,
  TAMPERED_LICENSE_KEY,
  VALID_LICENSE_KEY,
} from "./fixtures/testLicenses";

// Mock TraceUsageService for testing - returns 0 for all counts
const mockTraceUsageService: ITraceUsageService = {
  getCurrentMonthCount: async () => 0,
};

/** Email prefix for the memberships seeded by the seat tests, so cleanup can
 * find them without touching anything else in the dev database. */
const SEEDED_MEMBER_EMAIL_PREFIX = "license-handler-seat-";

describe("LicenseHandler Integration", () => {
  let organizationId: string;
  let handler: LicenseHandler;

  const seedActiveMembers = async (count: number): Promise<void> => {
    for (let index = 0; index < count; index++) {
      const email = `${SEEDED_MEMBER_EMAIL_PREFIX}${index}@acme.corp`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: `Seat ${index}` },
      });
      await prisma.organizationUser.upsert({
        where: {
          userId_organizationId: { userId: user.id, organizationId },
        },
        update: { disabledAt: null },
        create: { userId: user.id, organizationId, role: "MEMBER" },
      });
    }
  };

  const removeSeededMembers = async (): Promise<void> => {
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({
      where: { email: { startsWith: SEEDED_MEMBER_EMAIL_PREFIX } },
    });
  };

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
    // Cleanup - delete in correct order for foreign key constraints
    const org = await prisma.organization.findUnique({
      where: { slug: "license-handler-test-org" },
    });
    if (org) {
      await prisma.organizationUser.deleteMany({
        where: { organizationId: org.id },
      });
      await prisma.organization.delete({
        where: { id: org.id },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { startsWith: SEEDED_MEMBER_EMAIL_PREFIX } },
    });
  });

  afterEach(async () => {
    // Reset license and seeded memberships after each test
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
    await removeSeededMembers();
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
      expect("expired" in status && status.expired).toBe(true);
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

    it("does not call a license we did not sign expired, whatever date it claims", async () => {
      // The forged fixture claims an end date in the past. Comparing that date
      // would call it expired and start metering the seats it invents, so the
      // verdict has to follow the signature check instead.
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: FORGED_EXPIRED_LICENSE_KEY },
      });

      const status = await handler.getLicenseStatus(organizationId);

      expect(status.valid).toBe(false);
      expect("expired" in status && status.expired).toBe(false);
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
      await prisma.organizationUser.delete({
        where: { userId_organizationId: { userId: user.id, organizationId } },
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
        ENTERPRISE_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe(ENTERPRISE_LICENSE.plan.type);
        expect(result.planInfo.maxMembers).toBe(
          ENTERPRISE_LICENSE.plan.maxMembers,
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
        GARBAGE_DATA,
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
        TAMPERED_LICENSE_KEY,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid signature");
      }
    });

    /** @scenario Returns error for expired license */
    it("returns error for expired license", async () => {
      const result = await handler.validateAndStoreLicense(
        organizationId,
        EXPIRED_LICENSE_KEY,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("License expired");
      }
    });

    it("raises organization_not_found for a non-existent org", async () => {
      await expect(
        handler.validateAndStoreLicense(
          "non-existent-org-id",
          VALID_LICENSE_KEY,
        ),
      ).rejects.toMatchObject({ code: "organization_not_found" });
    });

    it("updates existing license when storing new one", async () => {
      // First store PRO license
      await handler.validateAndStoreLicense(organizationId, VALID_LICENSE_KEY);

      // Then store ENTERPRISE license
      const result = await handler.validateAndStoreLicense(
        organizationId,
        ENTERPRISE_LICENSE_KEY,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.planInfo.type).toBe(ENTERPRISE_LICENSE.plan.type);
        expect(result.planInfo.maxMembers).toBe(
          ENTERPRISE_LICENSE.plan.maxMembers,
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

    it("raises organization_not_found for a non-existent org", async () => {
      await expect(
        handler.removeLicense("non-existent-org-id"),
      ).rejects.toMatchObject({ code: "organization_not_found" });
    });
  });

  // ==========================================================================
  // getActivePlan Tests (ensuring no regression)
  // ==========================================================================

  describe("getActivePlan", () => {
    it("returns the Open Source plan with uncapped seats when no license exists", async () => {
      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(UNLIMITED_PLAN.type);
      expect(plan.maxMembers).toBe(UNLIMITED_PLAN.maxMembers);
      expect(plan.maxMembersLite).toBe(UNLIMITED_PLAN.maxMembersLite);
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

    /** @scenario On Cloud a lapsed license steps aside for the subscription */
    it("reports the baseline for a lapsed license, flagged free so a subscription applies", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: EXPIRED_LICENSE_KEY },
      });

      const plan = await handler.getActivePlan(organizationId);

      // This is the license *override* leg of the Cloud composite provider.
      // Reporting the baseline is how a Cloud org whose license lapsed falls
      // through to the Stripe subscription underneath it, which is why the
      // `free` flag matters as much as the numbers. Self-hosted has nothing to
      // fall through to and asks getSelfHostedPlan instead.
      expect(plan.type).toBe(UNLIMITED_PLAN.type);
      expect(plan.maxMembers).toBe(UNLIMITED_PLAN.maxMembers);
      expect(plan.free).toBe(true);
    });

    it("returns the Open Source plan with uncapped seats when the license is tampered", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: TAMPERED_LICENSE_KEY },
      });

      const plan = await handler.getActivePlan(organizationId);

      expect(plan.type).toBe(UNLIMITED_PLAN.type);
      expect(plan.maxMembers).toBe(UNLIMITED_PLAN.maxMembers);
    });
  });

  // ==========================================================================
  // getSelfHostedPlan Tests
  // ==========================================================================

  describe("getSelfHostedPlan", () => {
    describe("given a license whose term has ended", () => {
      /** @scenario A lapsed license keeps metering the seats it sold */
      /** @scenario An expired license keeps the seats it sold */
      it("keeps metering the seats the license sold", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { license: EXPIRED_LICENSE_KEY },
        });

        const plan = await handler.getSelfHostedPlan(organizationId);

        expect(plan.maxMembers).toBe(BASE_LICENSE.plan.maxMembers);
        expect(plan.type).toBe(BASE_LICENSE.plan.type);
        expect(plan.maxMembers).not.toBe(UNLIMITED_PLAN.maxMembers);
      });

      /** @scenario A lapsed license keeps the capabilities it bought */
      it("keeps the capabilities the license bought", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { license: EXPIRED_ENTERPRISE_LICENSE_KEY },
        });

        const plan = await handler.getSelfHostedPlan(organizationId);

        // isEnterpriseTier is what every enterprise-only tRPC procedure asks
        // before it will run, so this is the whole SSO / SCIM / audit-log
        // surface staying switched on past the end date.
        expect(isEnterpriseTier(plan.type)).toBe(true);
        expect(plan.free).toBe(false);
      });

      /** @scenario Nobody loses their seat on the day a license lapses */
      it("leaves every membership active even when the org is over those seats", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { license: EXPIRED_LICENSE_KEY },
        });
        const memberCount = BASE_LICENSE.plan.maxMembers + 3;
        await seedActiveMembers(memberCount);

        const plan = await handler.getSelfHostedPlan(organizationId);

        // Resolving a plan is a read. Landing over the seats is the same
        // over-seats state an organization reaches by activating a license for
        // fewer seats than it already had: everyone keeps working and an admin
        // chooses who to disable. See seat-reconciliation.feature.
        expect(plan.maxMembers).toBeLessThan(memberCount);
        const disabled = await prisma.organizationUser.count({
          where: { organizationId, disabledAt: { not: null } },
        });
        expect(disabled).toBe(0);
      });
    });

    describe("given a license we did not sign", () => {
      /** @scenario A license we did not sign is still not a license */
      /** @scenario An unreadable license leaves the deployment on the Open Source plan */
      it("resolves to the open-source baseline", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { license: TAMPERED_LICENSE_KEY },
        });

        const plan = await handler.getSelfHostedPlan(organizationId);

        expect(plan.type).toBe(UNLIMITED_PLAN.type);
        expect(plan.maxMembers).toBe(UNLIMITED_PLAN.maxMembers);
      });
    });

    describe("given no license at all", () => {
      /** @scenario A deployment that never had a license stays uncapped */
      /** @scenario An unlicensed deployment runs on the Open Source plan */
      it("resolves to the open-source baseline", async () => {
        const plan = await handler.getSelfHostedPlan(organizationId);

        expect(plan.type).toBe(UNLIMITED_PLAN.type);
        expect(plan.maxMembers).toBe(UNLIMITED_PLAN.maxMembers);
      });
    });

    describe("given a license still within its term", () => {
      it("resolves to the plan the license names", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { license: ENTERPRISE_LICENSE_KEY },
        });

        const plan = await handler.getSelfHostedPlan(organizationId);

        expect(plan.type).toBe(ENTERPRISE_LICENSE.plan.type);
        expect(plan.maxMembers).toBe(ENTERPRISE_LICENSE.plan.maxMembers);
      });
    });
  });
});
