/**
 * @vitest-environment node
 *
 * Integration tests for SubscriptionHandler.
 * Tests the LICENSE_ENFORCEMENT_ENABLED flag behavior with real database operations.
 */
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { SubscriptionHandler, getLicenseHandler } from "../subscriptionHandler";
import {
  generateTestLicense,
  generateExpiredTestLicense,
} from "../../../ee/licensing/__tests__/fixtures/generateTestLicense";
import { TEST_PUBLIC_KEY } from "../../../ee/licensing/__tests__/fixtures/testKeys";

// Set test public key for license validation
process.env.LANGWATCH_LICENSE_PUBLIC_KEY = TEST_PUBLIC_KEY;

describe("SubscriptionHandler Integration", () => {
  let organizationId: string;
  const originalEnforcementEnabled = process.env.LICENSE_ENFORCEMENT_ENABLED;

  beforeAll(async () => {
    // Create test organization
    const organization = await prisma.organization.upsert({
      where: { slug: "subscription-handler-test-org" },
      update: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
      create: {
        name: "Subscription Handler Test Org",
        slug: "subscription-handler-test-org",
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.organization.deleteMany({
      where: { slug: "subscription-handler-test-org" },
    });
    // Restore original env
    if (originalEnforcementEnabled !== undefined) {
      process.env.LICENSE_ENFORCEMENT_ENABLED = originalEnforcementEnabled;
    } else {
      delete process.env.LICENSE_ENFORCEMENT_ENABLED;
    }
  });

  afterEach(async () => {
    // Reset license after each test
    await prisma.organization.update({
      where: { id: organizationId },
      data: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
    });
  });

  describe("with LICENSE_ENFORCEMENT_ENABLED=false (default)", () => {
    beforeAll(() => {
      delete process.env.LICENSE_ENFORCEMENT_ENABLED;
    });

    it("returns SELF_HOSTED type when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("SELF_HOSTED");
    });

    it("allows unlimited members when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.maxMembers).toBe(99_999);
    });

    it("overrides adding limitations when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("ignores valid license when enforcement disabled", async () => {
      const validLicense = generateTestLicense({ plan: { maxMembers: 10 } });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: validLicense },
      });

      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("SELF_HOSTED");
    });
  });

  describe("with LICENSE_ENFORCEMENT_ENABLED=true", () => {
    beforeAll(() => {
      process.env.LICENSE_ENFORCEMENT_ENABLED = "true";
    });

    it("returns FREE type when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("FREE");
    });

    it("limits to 2 members when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.maxMembers).toBe(2);
    });

    it("limits to 2 projects when org has no license", async () => {
      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.maxProjects).toBe(2);
    });

    it("returns license plan type when org has valid license", async () => {
      const validLicense = generateTestLicense({
        plan: {
          type: "GROWTH",
          name: "Growth",
          maxMembers: 25,
          maxProjects: 50,
          maxMessagesPerMonth: 100_000,
          evaluationsCredit: 100,
          maxWorkflows: 50,
          canPublish: true,
        },
      });

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: validLicense },
      });

      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("GROWTH");
    });

    it("returns FREE type when org has expired license", async () => {
      const expiredLicense = generateExpiredTestLicense();

      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: expiredLicense },
      });

      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("FREE");
    });

    it("returns FREE type when org has invalid license", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { license: "invalid-license-data" },
      });

      const plan = await SubscriptionHandler.getActivePlan(organizationId);

      expect(plan.type).toBe("FREE");
    });
  });

  describe("LicenseHandler singleton", () => {
    it("getLicenseHandler returns same instance", () => {
      const handler1 = getLicenseHandler();
      const handler2 = getLicenseHandler();

      expect(handler1).toBe(handler2);
    });
  });
});
