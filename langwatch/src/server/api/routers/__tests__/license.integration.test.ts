/**
 * @vitest-environment node
 *
 * Integration tests for License tRPC endpoints.
 * Tests the router layer including permissions and error handling.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { LicenseHandler } from "../../../../../ee/licensing";
import { LicenseEnforcementRepository } from "../../../license-enforcement/license-enforcement.repository";
import {
  BASE_LICENSE,
  ENTERPRISE_LICENSE,
  VALID_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  GARBAGE_DATA,
  ENTERPRISE_LICENSE_KEY,
} from "../../../../../ee/licensing/__tests__/fixtures/testLicenses";
import { TEST_PUBLIC_KEY, TEST_PRIVATE_KEY } from "../../../../../ee/licensing/__tests__/fixtures/testKeys";
import { parseLicenseKey, verifySignature, PRO_TEMPLATE, ENTERPRISE_TEMPLATE } from "../../../../../ee/licensing";
import { OrganizationUserRole } from "@prisma/client";

// Mock getLicenseHandler to use test public key
vi.mock("../../../subscriptionHandler", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../subscriptionHandler")>();
  return {
    ...original,
    getLicenseHandler: () => new LicenseHandler({
      prisma,
      publicKey: TEST_PUBLIC_KEY,
      repository: new LicenseEnforcementRepository(prisma),
    }),
  };
});

describe("License Router Integration", () => {
  const testOrgSlug = "license-router-test-org";
  let organizationId: string;
  let adminCaller: ReturnType<typeof appRouter.createCaller>;
  let memberCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Create test organization
    const organization = await prisma.organization.upsert({
      where: { slug: testOrgSlug },
      update: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
      create: {
        name: "License Router Test Org",
        slug: testOrgSlug,
      },
    });
    organizationId = organization.id;

    // Create admin user
    const adminUser = await prisma.user.upsert({
      where: { email: "license-router-admin@test.com" },
      update: {},
      create: {
        email: "license-router-admin@test.com",
        name: "License Router Admin",
      },
    });

    // Add admin user to organization with ADMIN role
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: adminUser.id,
          organizationId,
        },
      },
      update: { role: OrganizationUserRole.ADMIN },
      create: {
        userId: adminUser.id,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // Create member user
    const memberUser = await prisma.user.upsert({
      where: { email: "license-router-member@test.com" },
      update: {},
      create: {
        email: "license-router-member@test.com",
        name: "License Router Member",
      },
    });

    // Add member user to organization with MEMBER role
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: memberUser.id,
          organizationId,
        },
      },
      update: { role: OrganizationUserRole.MEMBER },
      create: {
        userId: memberUser.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // Create admin caller
    const adminCtx = createInnerTRPCContext({
      session: {
        user: { id: adminUser.id },
        expires: "1",
      },
    });
    adminCaller = appRouter.createCaller(adminCtx);

    // Create member caller
    const memberCtx = createInnerTRPCContext({
      session: {
        user: { id: memberUser.id },
        expires: "1",
      },
    });
    memberCaller = appRouter.createCaller(memberCtx);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.organizationUser.deleteMany({
      where: { organizationId },
    });
    await prisma.organization.deleteMany({
      where: { slug: testOrgSlug },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ["license-router-admin@test.com", "license-router-member@test.com"],
        },
      },
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
  // getStatus Tests
  // ==========================================================================

  describe("getStatus", () => {
    it("returns hasLicense=false when org has no license", async () => {
      const status = await adminCaller.license.getStatus({ organizationId });

      expect(status.hasLicense).toBe(false);
      expect(status.valid).toBe(false);
    });

    it("returns valid=true with metadata for valid license", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: VALID_LICENSE_KEY },
      });

      const status = await adminCaller.license.getStatus({ organizationId });

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(true);
      if (!status.hasLicense || !("plan" in status)) {
        throw new Error("Expected license with plan metadata");
      }
      expect(status.plan).toBe(BASE_LICENSE.plan.type);
      expect(status.planName).toBe(BASE_LICENSE.plan.name);
    });

    it("allows member to view license status", async () => {
      const status = await memberCaller.license.getStatus({ organizationId });

      expect(status.hasLicense).toBe(false);
    });

    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.getStatus({ organizationId: "non-existent-org-id" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws error for empty organizationId", async () => {
      await expect(
        adminCaller.license.getStatus({ organizationId: "" })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // upload Tests
  // ==========================================================================

  describe("upload", () => {
    it("stores valid license and returns success", async () => {
      const result = await adminCaller.license.upload({
        organizationId,
        licenseKey: ENTERPRISE_LICENSE_KEY,
      });

      expect(result.success).toBe(true);
      expect(result.planInfo?.type).toBe(ENTERPRISE_LICENSE.plan.type);
      expect(result.planInfo?.maxMembers).toBe(ENTERPRISE_LICENSE.plan.maxMembers);

      // Verify stored in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true },
      });
      expect(org?.license).toBe(ENTERPRISE_LICENSE_KEY);
    });

    it("throws BAD_REQUEST for invalid license format", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId,
          licenseKey: GARBAGE_DATA,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST for expired license", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId,
          licenseKey: EXPIRED_LICENSE_KEY,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws error for empty license key", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId,
          licenseKey: "",
        })
      ).rejects.toThrow();
    });

    it("throws UNAUTHORIZED when member tries to upload", async () => {
      // Member has organization:view but not organization:manage, so permission check throws UNAUTHORIZED
      await expect(
        memberCaller.license.upload({
          organizationId,
          licenseKey: VALID_LICENSE_KEY,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.upload({
          organizationId: "non-existent-org-id",
          licenseKey: VALID_LICENSE_KEY,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });


  // ==========================================================================
  // remove Tests
  // ==========================================================================

  describe("remove", () => {
    it("removes existing license and returns success", async () => {
      // First store a license
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          license: VALID_LICENSE_KEY,
          licenseExpiresAt: new Date(),
          licenseLastValidatedAt: new Date(),
        },
      });

      const result = await adminCaller.license.remove({ organizationId });

      expect(result.success).toBe(true);
      expect(result.removed).toBe(true);

      // Verify cleared in database
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true },
      });
      expect(org?.license).toBeNull();
    });

    it("is idempotent - removing when no license exists returns success", async () => {
      const result = await adminCaller.license.remove({ organizationId });

      expect(result.success).toBe(true);
      expect(result.removed).toBe(true);
    });

    it("throws UNAUTHORIZED when member tries to remove", async () => {
      // Member has organization:view but not organization:manage, so permission check throws UNAUTHORIZED
      await expect(
        memberCaller.license.remove({ organizationId })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.remove({ organizationId: "non-existent-org-id" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ==========================================================================
  // generate Tests
  // ==========================================================================

  describe("generate", () => {
    const futureDate = new Date("2030-12-31T23:59:59Z");

    const getValidInput = () => ({
      organizationId,
      privateKey: TEST_PRIVATE_KEY,
      organizationName: "Test Corp",
      email: "admin@test.corp",
      expiresAt: futureDate,
      planType: "PRO" as const,
      plan: {
        maxMembers: 10,
        maxMembersLite: 5,
        maxTeams: 10,
        maxProjects: 20,
        maxMessagesPerMonth: 100000,
        evaluationsCredit: 500,
        maxWorkflows: 50,
        maxPrompts: 50,
        maxEvaluators: 50,
        maxScenarios: 50,
        maxAgents: 50,
        maxExperiments: 50,
        canPublish: true,
        usageUnit: "traces" as const,
      },
    });

    it("generates valid license key for valid input", async () => {
      const result = await adminCaller.license.generate(getValidInput());

      expect(result.licenseKey).toBeDefined();
      expect(typeof result.licenseKey).toBe("string");
      expect(result.licenseKey.length).toBeGreaterThan(0);
    });

    it("generates license that can be parsed and verified", async () => {
      const result = await adminCaller.license.generate(getValidInput());

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense).not.toBeNull();
      if (parsedLicense) {
        const isValid = verifySignature(parsedLicense, TEST_PUBLIC_KEY);
        expect(isValid).toBe(true);
      }
    });

    it("includes correct organization name and email in license", async () => {
      const result = await adminCaller.license.generate(getValidInput());

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.organizationName).toBe("Test Corp");
      expect(parsedLicense?.data.email).toBe("admin@test.corp");
    });

    it("includes correct plan limits in license", async () => {
      const result = await adminCaller.license.generate(getValidInput());

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.plan.maxMembers).toBe(10);
      expect(parsedLicense?.data.plan.maxProjects).toBe(20);
      expect(parsedLicense?.data.plan.maxMessagesPerMonth).toBe(100000);
    });

    it("generates unique license IDs for each call", async () => {
      const result1 = await adminCaller.license.generate(getValidInput());
      const result2 = await adminCaller.license.generate(getValidInput());

      const license1 = parseLicenseKey(result1.licenseKey);
      const license2 = parseLicenseKey(result2.licenseKey);

      expect(license1?.data.licenseId).not.toBe(license2?.data.licenseId);
    });

    it("uses PRO template defaults when planType is PRO", async () => {
      const result = await adminCaller.license.generate({
        ...getValidInput(),
        planType: "PRO",
      });

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.plan.type).toBe("PRO");
      expect(parsedLicense?.data.plan.name).toBe("Pro");
    });

    it("uses ENTERPRISE template defaults when planType is ENTERPRISE", async () => {
      const result = await adminCaller.license.generate({
        ...getValidInput(),
        planType: "ENTERPRISE",
        plan: {
          maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
          maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite ?? 50,
          maxTeams: ENTERPRISE_TEMPLATE.maxTeams ?? 100,
          maxProjects: ENTERPRISE_TEMPLATE.maxProjects,
          maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
          evaluationsCredit: ENTERPRISE_TEMPLATE.evaluationsCredit,
          maxWorkflows: ENTERPRISE_TEMPLATE.maxWorkflows,
          maxPrompts: ENTERPRISE_TEMPLATE.maxPrompts ?? 1000,
          maxEvaluators: ENTERPRISE_TEMPLATE.maxEvaluators ?? 1000,
          maxScenarios: ENTERPRISE_TEMPLATE.maxScenarios ?? 1000,
          maxAgents: ENTERPRISE_TEMPLATE.maxAgents ?? 1000,
          maxExperiments: ENTERPRISE_TEMPLATE.maxExperiments ?? 1000,
          canPublish: true,
          usageUnit: "traces" as const,
        },
      });

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.plan.type).toBe("ENTERPRISE");
      expect(parsedLicense?.data.plan.name).toBe("Enterprise");
    });

    it("throws BAD_REQUEST for past expiration date", async () => {
      await expect(
        adminCaller.license.generate({
          ...getValidInput(),
          expiresAt: new Date("2020-01-01"),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST for missing organization name", async () => {
      await expect(
        adminCaller.license.generate({
          ...getValidInput(),
          organizationName: "",
        })
      ).rejects.toThrow();
    });

    it("throws BAD_REQUEST for invalid email format", async () => {
      await expect(
        adminCaller.license.generate({
          ...getValidInput(),
          email: "not-an-email",
        })
      ).rejects.toThrow();
    });

    it("throws BAD_REQUEST for negative plan limits", async () => {
      await expect(
        adminCaller.license.generate({
          ...getValidInput(),
          plan: {
            ...getValidInput().plan,
            maxMembers: -5,
          },
        })
      ).rejects.toThrow();
    });

    it("includes usageUnit in generated license", async () => {
      const result = await adminCaller.license.generate(getValidInput());

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.plan.usageUnit).toBe("traces");
    });

    it("generates license with events usageUnit", async () => {
      const input = {
        ...getValidInput(),
        plan: { ...getValidInput().plan, usageUnit: "events" as const },
      };

      const result = await adminCaller.license.generate(input);

      const parsedLicense = parseLicenseKey(result.licenseKey);
      expect(parsedLicense?.data.plan.usageUnit).toBe("events");
    });

    it("throws UNAUTHORIZED when member tries to generate", async () => {
      await expect(
        memberCaller.license.generate(getValidInput())
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
