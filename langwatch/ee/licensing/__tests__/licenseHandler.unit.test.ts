import { describe, expect, it, vi, beforeEach } from "vitest";
import { LicenseHandler } from "../licenseHandler";
import { FREE_PLAN, UNLIMITED_PLAN } from "../constants";
import {
  generateTestLicense,
  generateExpiredTestLicense,
  generateTamperedTestLicense,
} from "./fixtures/generateTestLicense";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";

import type { PrismaClient } from "@prisma/client";

// Mock Prisma client factory
function createMockPrisma(overrides: {
  organizationFindUnique?: () => Promise<unknown>;
  organizationUpdate?: () => Promise<unknown>;
} = {}) {
  return {
    organization: {
      findUnique: vi.fn().mockImplementation(
        overrides.organizationFindUnique ?? (() => Promise.resolve(null))
      ),
      update: vi.fn().mockImplementation(
        overrides.organizationUpdate ?? (() => Promise.resolve({}))
      ),
    },
  } as unknown as PrismaClient;
}

describe("LicenseHandler", () => {
  describe("getActivePlan", () => {
    describe("when license enforcement is disabled", () => {
      it("returns UNLIMITED_PLAN regardless of license presence", async () => {
        const validLicense = generateTestLicense({ plan: { maxMembers: 5 } });
        const prisma = createMockPrisma({
          organizationFindUnique: () =>
            Promise.resolve({ license: validLicense }),
        });

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: false,
          publicKey: TEST_PUBLIC_KEY,
        });

        const plan = await handler.getActivePlan("org-123");

        expect(plan.type).toBe("SELF_HOSTED");
        expect(plan.maxMembers).toBe(99_999);
      });

      it("returns UNLIMITED_PLAN when enforcement is not set", async () => {
        const prisma = createMockPrisma({
          organizationFindUnique: () => Promise.resolve({ license: null }),
        });

        const handler = new LicenseHandler({
          prisma,
          publicKey: TEST_PUBLIC_KEY,
          // licenseEnforcementEnabled not set (defaults to false)
        });

        const plan = await handler.getActivePlan("org-123");

        expect(plan.type).toBe("SELF_HOSTED");
      });
    });

    describe("when license enforcement is enabled", () => {
      describe("no license stored", () => {
        it("returns UNLIMITED_PLAN when organization has no license", async () => {
          const prisma = createMockPrisma({
            organizationFindUnique: () => Promise.resolve({ license: null }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("SELF_HOSTED");
          expect(plan.maxMembers).toBe(99_999);
        });

        it("returns UNLIMITED_PLAN when organization does not exist", async () => {
          const prisma = createMockPrisma({
            organizationFindUnique: () => Promise.resolve(null),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("SELF_HOSTED");
        });
      });

      describe("valid license stored", () => {
        it("returns license-based PlanInfo with correct limits", async () => {
          const validLicense = generateTestLicense({
            plan: {
              type: "GROWTH",
              name: "Growth",
              maxMembers: 10,
              maxProjects: 99,
              maxMessagesPerMonth: 100_000,
              evaluationsCredit: 50,
              maxWorkflows: 100,
              canPublish: true,
            },
          });
          const prisma = createMockPrisma({
            organizationFindUnique: () =>
              Promise.resolve({ license: validLicense }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("GROWTH");
          expect(plan.maxMembers).toBe(10);
          expect(plan.maxProjects).toBe(99);
          expect(plan.maxMessagesPerMonth).toBe(100_000);
          expect(plan.canPublish).toBe(true);
        });

        it("sets free to false for licensed plans", async () => {
          const validLicense = generateTestLicense();
          const prisma = createMockPrisma({
            organizationFindUnique: () =>
              Promise.resolve({ license: validLicense }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.free).toBe(false);
        });
      });

      describe("invalid license stored", () => {
        it("returns FREE_PLAN when license has invalid signature", async () => {
          const tamperedLicense = generateTamperedTestLicense();
          const prisma = createMockPrisma({
            organizationFindUnique: () =>
              Promise.resolve({ license: tamperedLicense }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("FREE");
          expect(plan.maxMembers).toBe(2);
          expect(plan.maxProjects).toBe(2);
        });

        it("returns FREE_PLAN when license is expired", async () => {
          const expiredLicense = generateExpiredTestLicense();
          const prisma = createMockPrisma({
            organizationFindUnique: () =>
              Promise.resolve({ license: expiredLicense }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("FREE");
          expect(plan.canPublish).toBe(false);
        });

        it("returns FREE_PLAN when license is malformed", async () => {
          const prisma = createMockPrisma({
            organizationFindUnique: () =>
              Promise.resolve({ license: "not-a-valid-license-at-all" }),
          });

          const handler = new LicenseHandler({
            prisma,
            licenseEnforcementEnabled: true,
            publicKey: TEST_PUBLIC_KEY,
          });

          const plan = await handler.getActivePlan("org-123");

          expect(plan.type).toBe("FREE");
        });
      });
    });
  });

  describe("storeLicense", () => {
    describe("success cases", () => {
      it("stores valid license and returns planInfo", async () => {
        const validLicense = generateTestLicense({
          plan: { type: "PRO", name: "Pro", maxMembers: 100 },
        });
        const prisma = createMockPrisma();

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        const result = await handler.storeLicense("org-123", validLicense);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.planInfo.type).toBe("PRO");
          expect(result.planInfo.maxMembers).toBe(100);
        }
      });

      it("updates organization with license data", async () => {
        const validLicense = generateTestLicense();
        const updateMock = vi.fn().mockResolvedValue({});
        const prisma = createMockPrisma({
          organizationUpdate: updateMock,
        });

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        await handler.storeLicense("org-123", validLicense);

        expect(updateMock).toHaveBeenCalledWith({
          where: { id: "org-123" },
          data: expect.objectContaining({
            license: validLicense,
            licenseExpiresAt: expect.any(Date),
            licenseLastValidatedAt: expect.any(Date),
          }),
        });
      });

      it("sets licenseExpiresAt from license data", async () => {
        const expiresAt = "2027-12-31T23:59:59Z";
        const validLicense = generateTestLicense({ expiresAt });
        const updateMock = vi.fn().mockResolvedValue({});
        const prisma = createMockPrisma({
          organizationUpdate: updateMock,
        });

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        await handler.storeLicense("org-123", validLicense);

        const callData = updateMock.mock.calls[0]?.[0]?.data;
        expect(callData.licenseExpiresAt.toISOString()).toBe("2027-12-31T23:59:59.000Z");
      });
    });

    describe("failure cases", () => {
      it("rejects invalid license format", async () => {
        const prisma = createMockPrisma();

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        const result = await handler.storeLicense(
          "org-123",
          "not-a-valid-license"
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("Invalid license format");
        }
      });

      it("does not update organization when license is invalid", async () => {
        const updateMock = vi.fn().mockResolvedValue({});
        const prisma = createMockPrisma({
          organizationUpdate: updateMock,
        });

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        await handler.storeLicense("org-123", "invalid-license");

        expect(updateMock).not.toHaveBeenCalled();
      });

      it("rejects license with invalid signature", async () => {
        const tamperedLicense = generateTamperedTestLicense();
        const prisma = createMockPrisma();

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        const result = await handler.storeLicense("org-123", tamperedLicense);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("Invalid signature");
        }
      });

      it("rejects expired license", async () => {
        const expiredLicense = generateExpiredTestLicense();
        const prisma = createMockPrisma();

        const handler = new LicenseHandler({
          prisma,
          licenseEnforcementEnabled: true,
          publicKey: TEST_PUBLIC_KEY,
        });

        const result = await handler.storeLicense("org-123", expiredLicense);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("License expired");
        }
      });
    });
  });

  describe("getLicenseStatus", () => {
    it("returns hasLicense false when no license is stored", async () => {
      const prisma = createMockPrisma({
        organizationFindUnique: () =>
          Promise.resolve({
            license: null,
            licenseExpiresAt: null,
            _count: { members: 5 },
          }),
      });

      const handler = new LicenseHandler({
        prisma,
        licenseEnforcementEnabled: true,
        publicKey: TEST_PUBLIC_KEY,
      });

      const status = await handler.getLicenseStatus("org-123");

      expect(status.hasLicense).toBe(false);
      expect(status.valid).toBe(false);
    });

    it("returns valid status for valid license", async () => {
      const validLicense = generateTestLicense({
        plan: { type: "GROWTH", name: "Growth Plan" },
        expiresAt: "2027-06-30T23:59:59Z",
        organizationName: "Acme Corp",
      });
      const prisma = createMockPrisma({
        organizationFindUnique: () =>
          Promise.resolve({
            license: validLicense,
            licenseExpiresAt: new Date("2027-06-30T23:59:59Z"),
            _count: { members: 8 },
          }),
      });

      const handler = new LicenseHandler({
        prisma,
        licenseEnforcementEnabled: true,
        publicKey: TEST_PUBLIC_KEY,
      });

      const status = await handler.getLicenseStatus("org-123");

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.plan).toBe("GROWTH");
      expect(status.planName).toBe("Growth Plan");
      expect(status.expiresAt).toBe("2027-06-30T23:59:59Z");
      expect(status.organizationName).toBe("Acme Corp");
      expect(status.currentMembers).toBe(8);
    });

    it("returns invalid status for expired license", async () => {
      const expiredLicense = generateExpiredTestLicense({
        plan: { type: "PRO", name: "Pro" },
      });
      const prisma = createMockPrisma({
        organizationFindUnique: () =>
          Promise.resolve({
            license: expiredLicense,
            licenseExpiresAt: new Date("2020-01-01T00:00:00Z"),
            _count: { members: 3 },
          }),
      });

      const handler = new LicenseHandler({
        prisma,
        licenseEnforcementEnabled: true,
        publicKey: TEST_PUBLIC_KEY,
      });

      const status = await handler.getLicenseStatus("org-123");

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
      expect(status.plan).toBe("PRO");
    });

    it("returns invalid status for tampered license", async () => {
      const tamperedLicense = generateTamperedTestLicense();
      const prisma = createMockPrisma({
        organizationFindUnique: () =>
          Promise.resolve({
            license: tamperedLicense,
            licenseExpiresAt: new Date("2025-12-31T23:59:59Z"),
            _count: { members: 2 },
          }),
      });

      const handler = new LicenseHandler({
        prisma,
        licenseEnforcementEnabled: true,
        publicKey: TEST_PUBLIC_KEY,
      });

      const status = await handler.getLicenseStatus("org-123");

      expect(status.hasLicense).toBe(true);
      expect(status.valid).toBe(false);
    });
  });

  describe("removeLicense", () => {
    it("clears all license-related fields", async () => {
      const updateMock = vi.fn().mockResolvedValue({});
      const prisma = createMockPrisma({
        organizationUpdate: updateMock,
      });

      const handler = new LicenseHandler({
        prisma,
        licenseEnforcementEnabled: true,
        publicKey: TEST_PUBLIC_KEY,
      });

      await handler.removeLicense("org-123");

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "org-123" },
        data: {
          license: null,
          licenseExpiresAt: null,
          licenseLastValidatedAt: null,
        },
      });
    });
  });
});
