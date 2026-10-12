/**
 * The boot redemption against a real database: the license it gets back is
 * stored the way a License page activation stores it, and the next boot finds
 * it and sends nothing.
 *
 * @see specs/licensing/configured-license-forms.feature
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../src/server/db";
import { LicenseEnforcementRepository } from "../../../../src/server/license-enforcement/license-enforcement.repository";
import { TEST_PUBLIC_KEY } from "../../__tests__/fixtures/testKeys";
import { VALID_LICENSE_KEY } from "../../__tests__/fixtures/testLicenses";
import { LicenseHandler } from "../../licenseHandler";
import { validateLicense } from "../../validation";
import {
  activateConfiguredLicense,
  type ConfiguredActivationDependencies,
} from "../configuredActivation";

const TEST_ORG_SLUG = "configured-activation-test-org";

describe("activateConfiguredLicense against the database", () => {
  let organizationId: string;
  const handler = new LicenseHandler({
    prisma,
    publicKey: TEST_PUBLIC_KEY,
    repository: new LicenseEnforcementRepository(prisma),
    traceUsageService: { getCurrentMonthCount: async () => 0 },
  });

  beforeAll(async () => {
    const organization = await prisma.organization.upsert({
      where: { slug: TEST_ORG_SLUG },
      update: { license: null, licenseExpiresAt: null },
      create: { name: "Configured Activation Org", slug: TEST_ORG_SLUG },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    const org = await prisma.organization.findUnique({
      where: { slug: TEST_ORG_SLUG },
      select: { id: true },
    });
    if (org) await prisma.organization.delete({ where: { id: org.id } });
  });

  const boot = (activate: ConfiguredActivationDependencies["activate"]) =>
    activateConfiguredLicense({
      value: "LW-A1B2-C3D4-E5F6-G7H8",
      connectPermitted: true,
      findOrganizations: () =>
        prisma.organization.findMany({
          where: { id: organizationId },
          select: { id: true, license: true },
        }),
      instanceId: async () => "instance-integration",
      activate,
      store: async ({ organizationId: id, license }) => {
        const result = await handler.validateAndStoreLicense(id, license);
        return result.success
          ? { success: true }
          : { success: false, error: result.error };
      },
      isValidLicense: (license) =>
        validateLicense({ licenseKey: license, publicKey: TEST_PUBLIC_KEY })
          .valid,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

  describe("when the install boots twice with the same activation code", () => {
    /** @scenario "an activation code in the license variable is redeemed at boot" */
    /** @scenario "a boot after the code was redeemed does not redeem it again" */
    it("stores the license on the first boot and sends nothing on the second", async () => {
      const activate = vi.fn(async () => ({ license: VALID_LICENSE_KEY }));

      expect(await boot(activate)).toEqual({
        outcome: "activated",
        organizationId,
      });
      const stored = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true, licenseExpiresAt: true },
      });
      expect(stored?.license).toBe(VALID_LICENSE_KEY);
      expect(stored?.licenseExpiresAt).not.toBeNull();

      expect(await boot(activate)).toEqual({
        outcome: "already_licensed",
        organizationId,
      });
      expect(activate).toHaveBeenCalledTimes(1);
    });
  });
});
