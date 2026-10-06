import { describe, expect, it } from "vitest";

import { createTestLicensingApp, VALID_LICENSE_KEY } from "../../__tests__/testing.ts";
import { MemoryOrganizationLicenseRepository } from "../../repositories/memory/memory.organization-license.repository.ts";
import type { OrganizationLicenseReads } from "../../repositories/organization-license.repository.ts";
import { LicensingInfrastructureService } from "../licensing-infrastructure.service.ts";

const LICENSED_ORGANIZATION_ID = "org_paid";

function licenceRows(): {
  candidates: MemoryOrganizationLicenseRepository;
  licenses: OrganizationLicenseReads;
} {
  const candidates = MemoryOrganizationLicenseRepository.create(
    new Map([[LICENSED_ORGANIZATION_ID, VALID_LICENSE_KEY]]),
  );
  const licenses: OrganizationLicenseReads = {
    getOrganizationLicense: async (organizationId: string) => ({
      licenseKey: organizationId === LICENSED_ORGANIZATION_ID ? VALID_LICENSE_KEY : null,
    }),
    findOrganizationsWithLicense: () => candidates.findOrganizationsWithLicense(),
  };

  return { candidates, licenses };
}

function composeWithoutMutation() {
  return LicensingInfrastructureService.create({ role: "worker" }).withoutMutation({
    licenses: licenceRows().licenses,
    getMemberCount: async () => 0,
    getMembersLiteCount: async () => 0,
  });
}

describe("licensing infrastructure composed without licence mutation", () => {
  /** @scenario "A process that composes no licence mutation still scans the licence rows" */
  it("accepts a key activated on an organization when no instance key is set", async () => {
    const app = await createTestLicensingApp({
      repositories: { organizationLicenses: licenceRows().candidates },
      role: "worker",
    });

    await expect(app.inspectPlatformAccess()).resolves.toMatchObject({
      allowed: true,
      inspections: [
        { source: "organization", organizationId: LICENSED_ORGANIZATION_ID, valid: true },
      ],
    });
  });

  /** @scenario "A process that composes no licence mutation still scans the licence rows" */
  it("keeps refusing the mutation ports by process name", async () => {
    const { repository } = composeWithoutMutation();

    await expect(repository.organizationExists(LICENSED_ORGANIZATION_ID)).rejects.toThrow(
      "the worker does not compose license mutation",
    );
    await expect(repository.removeLicense(LICENSED_ORGANIZATION_ID)).rejects.toThrow(
      "the worker does not compose license mutation",
    );
  });

  it("leaves an organization that carries no key out of the scan", async () => {
    const { candidates } = licenceRows();
    await candidates.removeLicense(LICENSED_ORGANIZATION_ID);

    await expect(candidates.findOrganizationsWithLicense()).resolves.toEqual([]);
  });
});
