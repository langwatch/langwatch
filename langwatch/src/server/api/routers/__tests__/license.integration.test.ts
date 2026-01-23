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
import { TRPCError } from "@trpc/server";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { LicenseHandler } from "../../../../../ee/licensing";
import {
  BASE_LICENSE,
  ENTERPRISE_LICENSE,
  VALID_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  GARBAGE_DATA,
  ENTERPRISE_LICENSE_KEY,
} from "../../../../../ee/licensing/__tests__/fixtures/testLicenses";
import { TEST_PUBLIC_KEY } from "../../../../../ee/licensing/__tests__/fixtures/testKeys";
import { OrganizationUserRole } from "@prisma/client";

// Mock getLicenseHandler to use test public key
vi.mock("../../../subscriptionHandler", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../subscriptionHandler")>();
  return {
    ...original,
    getLicenseHandler: () => new LicenseHandler({ prisma, publicKey: TEST_PUBLIC_KEY }),
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

    it("throws NOT_FOUND for non-existent organization", async () => {
      await expect(
        adminCaller.license.getStatus({ organizationId: "non-existent-org-id" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
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

    it("throws FORBIDDEN when member tries to upload", async () => {
      await expect(
        memberCaller.license.upload({
          organizationId,
          licenseKey: VALID_LICENSE_KEY,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws NOT_FOUND for non-existent organization", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId: "non-existent-org-id",
          licenseKey: VALID_LICENSE_KEY,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
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

    it("throws FORBIDDEN when member tries to remove", async () => {
      await expect(
        memberCaller.license.remove({ organizationId })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws NOT_FOUND for non-existent organization", async () => {
      await expect(
        adminCaller.license.remove({ organizationId: "non-existent-org-id" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
