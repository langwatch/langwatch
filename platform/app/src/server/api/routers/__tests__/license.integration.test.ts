/**
 * @vitest-environment node
 *
 * Integration tests for License tRPC endpoints.
 * Tests the router layer including permissions and error handling.
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { LicenseHandler } from "../../../../../ee/licensing";
import { TEST_PUBLIC_KEY } from "../../../../../ee/licensing/__tests__/fixtures/testKeys";
import {
  BASE_LICENSE,
  ENTERPRISE_LICENSE,
  ENTERPRISE_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  GARBAGE_DATA,
  VALID_LICENSE_KEY,
} from "../../../../../ee/licensing/__tests__/fixtures/testLicenses";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { prisma } from "../../../db";
import { LicenseEnforcementRepository } from "../../../license-enforcement/license-enforcement.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

/**
 * The connect host, stood in for: activation is tested against a real host in
 * `connect.license-activate.integration.test.ts`, and what matters here is that
 * whatever comes back goes through the same validation and storage as a license
 * a customer pasted.
 */
const activation = vi.hoisted(() => ({ license: "", calls: 0 }));
vi.mock("@ee/licensing/connect/install/connectLicenseClient", () => ({
  getConnectLicenseClient: () => ({
    activate: async () => {
      activation.calls += 1;
      return {
        license: activation.license,
        planType: "ENTERPRISE",
        maxMembers: 25,
        expiresAt: new Date().toISOString(),
        services: [],
      };
    },
  }),
  resetConnectLicenseClient: async () => undefined,
}));
vi.mock("@ee/licensing/connect/install/instanceIdentity", async (original) => ({
  ...(await original<
    typeof import("@ee/licensing/connect/install/instanceIdentity")
  >()),
  installInstanceId: async () => "instance-license-router-test",
}));

// Mock getLicenseHandler to use test public key
vi.mock("../../../subscriptionHandler", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../subscriptionHandler")>();
  return {
    ...original,
    getLicenseHandler: () =>
      new LicenseHandler({
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

    // Grant admin user an org-scoped ADMIN RoleBinding so permission checks pass
    await cleanupTestRows(prisma, [
      [
        "grant",
        { organizationId, principalType: "USER", principalId: adminUser.id },
      ],
      ["roleBinding", { organizationId, userId: adminUser.id }],
    ]);
    await seedRoleBinding(prisma, {
      id: `rb-lic-admin-${nanoid(8)}`,
      organizationId,
      userId: adminUser.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
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

    // Grant member an org-scoped MEMBER RoleBinding so organization:view checks pass
    await cleanupTestRows(prisma, [
      [
        "grant",
        { organizationId, principalType: "USER", principalId: memberUser.id },
      ],
      ["roleBinding", { organizationId, userId: memberUser.id }],
    ]);
    await seedRoleBinding(prisma, {
      id: `rb-lic-member-${nanoid(8)}`,
      organizationId,
      userId: memberUser.id,
      role: TeamUserRole.MEMBER,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
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
    await cleanupTestRows(prisma, [
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["organization", { slug: testOrgSlug }],
      [
        "user",
        {
          email: {
            in: [
              "license-router-admin@test.com",
              "license-router-member@test.com",
            ],
          },
        },
      ],
    ]);
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
    /** @scenario Gets license status for organization without license */
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

    /** @scenario Rejects request for unauthorized organization */
    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.getStatus({
          organizationId: "non-existent-org-id",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws error for empty organizationId", async () => {
      await expect(
        adminCaller.license.getStatus({ organizationId: "" }),
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // activate Tests
  // ==========================================================================

  describe("activate", () => {
    /** @scenario "The install stores what the code minted exactly as a pasted license" */
    it("stores the license the code minted the way it stores a pasted one", async () => {
      activation.license = ENTERPRISE_LICENSE_KEY;
      activation.calls = 0;

      const result = await adminCaller.license.activate({
        organizationId,
        code: "LW-A1B2-C3D4-E5F6-G7H8",
      });

      expect(result.success).toBe(true);
      expect(activation.calls).toBe(1);

      const status = await adminCaller.license.getStatus({ organizationId });
      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(true);
    });

    it("refuses a license the connect host answered with that does not verify", async () => {
      activation.license = GARBAGE_DATA;

      await expect(
        adminCaller.license.activate({
          organizationId,
          code: "LW-A1B2-C3D4-E5F6-G7H8",
        }),
      ).rejects.toThrow();

      const status = await adminCaller.license.getStatus({ organizationId });
      expect(status.hasLicense).toBe(false);
    });

    it("refuses a member, because activating a license is an organization change", async () => {
      activation.license = ENTERPRISE_LICENSE_KEY;

      await expect(
        memberCaller.license.activate({
          organizationId,
          code: "LW-A1B2-C3D4-E5F6-G7H8",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
      expect(result.planInfo?.maxMembers).toBe(
        ENTERPRISE_LICENSE.plan.maxMembers,
      );

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
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST for expired license", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId,
          licenseKey: EXPIRED_LICENSE_KEY,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws error for empty license key", async () => {
      await expect(
        adminCaller.license.upload({
          organizationId,
          licenseKey: "",
        }),
      ).rejects.toThrow();
    });

    it("throws UNAUTHORIZED when member tries to upload", async () => {
      // Member has organization:view but not organization:manage, so permission check throws UNAUTHORIZED
      await expect(
        memberCaller.license.upload({
          organizationId,
          licenseKey: VALID_LICENSE_KEY,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.upload({
          organizationId: "non-existent-org-id",
          licenseKey: VALID_LICENSE_KEY,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
        memberCaller.license.remove({ organizationId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws UNAUTHORIZED for non-existent organization", async () => {
      // User is not a member of non-existent org, so permission check fails before NOT_FOUND can be thrown
      await expect(
        adminCaller.license.remove({ organizationId: "non-existent-org-id" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
