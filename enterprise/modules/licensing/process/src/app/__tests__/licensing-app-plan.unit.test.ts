import { describe, expect, it } from "vitest";

import {
  createTestLicensingApp,
  ENTERPRISE_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
} from "../../__tests__/testing.ts";
import { MemoryOrganizationLicenseRepository } from "../../repositories/memory/memory.organization-license.repository.ts";
import type { OrganizationLicenseRepository } from "../../repositories/organization-license.repository.ts";

/** The licence rows, recording each organization whose key was read. */
function recordingLicenses(rows: MemoryOrganizationLicenseRepository): {
  read: string[];
  licenses: OrganizationLicenseRepository;
} {
  const read: string[] = [];
  return {
    read,
    licenses: {
      getOrganizationLicense: (organizationId) => {
        read.push(organizationId);
        return rows.getOrganizationLicense(organizationId);
      },
      findOrganizationsWithLicense: () => rows.findOrganizationsWithLicense(),
      organizationExists: (organizationId) => rows.organizationExists(organizationId),
      storeLicense: (organizationId, license) => rows.storeLicense(organizationId, license),
      removeLicense: (organizationId) => rows.removeLicense(organizationId),
    },
  };
}

describe("the installed licensing application's plan operation", () => {
  it("checks each organization's stored signature and preserves the unlicensed result", async () => {
    const { read, licenses } = recordingLicenses(
      MemoryOrganizationLicenseRepository.create(
        new Map([
          ["paid", ENTERPRISE_LICENSE_KEY],
          ["tampered", TAMPERED_LICENSE_KEY],
          ["unlicensed", null],
        ]),
      ),
    );
    const app = await createTestLicensingApp({
      repositories: { organizationLicenses: licenses },
      config: { isSaas: true },
    });
    expect(await app.resolve({ organizationId: "paid" })).toMatchObject({
      granted: true,
      plan: { type: "ENTERPRISE", free: false },
    });
    expect(await app.resolve({ organizationId: "unlicensed" })).toMatchObject({
      granted: true,
      plan: { free: true },
    });
    expect(await app.resolve({ organizationId: "tampered" })).toMatchObject({
      granted: true,
      plan: { free: true },
    });
    expect(read).toEqual(["paid", "unlicensed", "tampered"]);
  });
});
