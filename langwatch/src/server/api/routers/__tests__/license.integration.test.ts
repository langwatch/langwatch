/**
 * @vitest-environment node
 *
 * Integration tests for License tRPC endpoints.
 * Tests license upload, status, and removal through the tRPC layer.
 */
import { OrganizationUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  generateTestLicense,
  generateExpiredTestLicense,
  generateTamperedTestLicense,
} from "../../../../../ee/licensing/__tests__/fixtures/generateTestLicense";
import { TEST_PUBLIC_KEY } from "../../../../../ee/licensing/__tests__/fixtures/testKeys";

// Set test public key for license validation
process.env.LANGWATCH_LICENSE_PUBLIC_KEY = TEST_PUBLIC_KEY;

describe("License Endpoints", () => {
  let organizationId: string;
  let userId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let memberCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Create test organization
    const organization = await prisma.organization.upsert({
      where: { slug: "license-test-org" },
      update: {},
      create: {
        name: "License Test Organization",
        slug: "license-test-org",
      },
    });
    organizationId = organization.id;

    // Create admin user
    const adminUser = await prisma.user.upsert({
      where: { email: "license-admin@test.com" },
      update: {},
      create: {
        name: "License Admin",
        email: "license-admin@test.com",
      },
    });
    userId = adminUser.id;

    // Make user an ADMIN of the organization
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: adminUser.id,
          organizationId: organization.id,
        },
      },
      update: { role: OrganizationUserRole.ADMIN },
      create: {
        userId: adminUser.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // Create admin caller
    const adminCtx = createInnerTRPCContext({
      session: {
        user: { id: adminUser.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(adminCtx);

    // Create member user for permission tests
    const memberUser = await prisma.user.upsert({
      where: { email: "license-member@test.com" },
      update: {},
      create: {
        name: "License Member",
        email: "license-member@test.com",
      },
    });

    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: memberUser.id,
          organizationId: organization.id,
        },
      },
      update: { role: OrganizationUserRole.MEMBER },
      create: {
        userId: memberUser.id,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    const memberCtx = createInnerTRPCContext({
      session: {
        user: { id: memberUser.id },
        expires: "1",
      },
    });
    memberCaller = appRouter.createCaller(memberCtx);

    // Clear any existing license
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.organizationUser.deleteMany({
      where: { organizationId },
    });
    await prisma.organization.delete({
      where: { id: organizationId },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["license-admin@test.com", "license-member@test.com"] },
      },
    });
  });

  describe("getStatus", () => {
    it("returns hasLicense false when no license exists", async () => {
      const result = await caller.license.getStatus({ organizationId });

      expect(result.hasLicense).toBe(false);
      expect(result.valid).toBe(false);
    });

    it("returns license details after upload", async () => {
      const licenseKey = generateTestLicense({
        organizationName: "Test Org",
        plan: { type: "ENTERPRISE", name: "Enterprise" },
      });

      await caller.license.upload({ organizationId, licenseKey });
      const result = await caller.license.getStatus({ organizationId });

      expect(result.hasLicense).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.plan).toBe("ENTERPRISE");
      expect(result.planName).toBe("Enterprise");
      expect(result.organizationName).toBe("Test Org");
      expect(result.expiresAt).toBeDefined();

      // Clean up
      await caller.license.remove({ organizationId });
    });
  });

  describe("upload", () => {
    it("uploads a valid license", async () => {
      const licenseKey = generateTestLicense({
        plan: { type: "PRO", name: "Pro", maxMembers: 50 },
      });

      const result = await caller.license.upload({ organizationId, licenseKey });

      expect(result.success).toBe(true);
      expect(result.planInfo).toBeDefined();
      expect(result.planInfo.type).toBe("PRO");
      expect(result.planInfo.maxMembers).toBe(50);

      // Clean up
      await caller.license.remove({ organizationId });
    });

    it("throws BAD_REQUEST for invalid license format", async () => {
      const invalidLicense = "not-a-valid-base64-license";

      await expect(
        caller.license.upload({ organizationId, licenseKey: invalidLicense })
      ).rejects.toThrow(TRPCError);

      try {
        await caller.license.upload({
          organizationId,
          licenseKey: invalidLicense,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
        expect((error as TRPCError).message).toBe("Invalid license format");
      }
    });

    it("throws BAD_REQUEST for expired license", async () => {
      const expiredLicense = generateExpiredTestLicense();

      await expect(
        caller.license.upload({ organizationId, licenseKey: expiredLicense })
      ).rejects.toThrow(TRPCError);

      try {
        await caller.license.upload({
          organizationId,
          licenseKey: expiredLicense,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
        expect((error as TRPCError).message).toBe("License expired");
      }
    });

    it("throws BAD_REQUEST for tampered license (invalid signature)", async () => {
      const tamperedLicense = generateTamperedTestLicense();

      await expect(
        caller.license.upload({ organizationId, licenseKey: tamperedLicense })
      ).rejects.toThrow(TRPCError);

      try {
        await caller.license.upload({
          organizationId,
          licenseKey: tamperedLicense,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("BAD_REQUEST");
        expect((error as TRPCError).message).toBe("Invalid signature");
      }
    });
  });

  describe("remove", () => {
    it("removes an existing license", async () => {
      // First upload a license
      const licenseKey = generateTestLicense();
      await caller.license.upload({ organizationId, licenseKey });

      // Verify it exists
      let status = await caller.license.getStatus({ organizationId });
      expect(status.hasLicense).toBe(true);

      // Remove it
      const result = await caller.license.remove({ organizationId });
      expect(result.success).toBe(true);

      // Verify it's gone
      status = await caller.license.getStatus({ organizationId });
      expect(status.hasLicense).toBe(false);
    });
  });

  describe("permissions", () => {
    it("allows members to view license status", async () => {
      // Members should be able to view (organization:view permission)
      const result = await memberCaller.license.getStatus({ organizationId });
      expect(result).toBeDefined();
      expect(result.hasLicense).toBe(false);
    });

    it("denies members from uploading licenses", async () => {
      const licenseKey = generateTestLicense();

      // Members should not be able to upload (requires organization:manage)
      await expect(
        memberCaller.license.upload({ organizationId, licenseKey })
      ).rejects.toThrow();
    });

    it("denies members from removing licenses", async () => {
      // Members should not be able to remove (requires organization:manage)
      await expect(
        memberCaller.license.remove({ organizationId })
      ).rejects.toThrow();
    });
  });
});
