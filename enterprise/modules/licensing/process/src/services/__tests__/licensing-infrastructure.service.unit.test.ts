import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { LicensingApp } from "../../app/licensing.app.ts";
import type { OrganizationLicenseReads } from "../../app/licensing.members.ts";
import { MemoryOrganizationLicenseRepository } from "../../repositories/memory/memory.organization-license.repository.ts";
import { TEST_LICENSING_CONFIG, VALID_LICENSE_KEY } from "../../testing.ts";
import { LicensingInfrastructureService } from "../licensing-infrastructure.service.ts";

const LICENSED_ORGANIZATION_ID = "org_paid";

function licenceRows(): {
  candidates: MemoryOrganizationLicenseRepository;
  licenses: OrganizationLicenseReads;
} {
  const candidates = MemoryOrganizationLicenseRepository.create();
  candidates.activate(LICENSED_ORGANIZATION_ID, VALID_LICENSE_KEY);
  const licenses: OrganizationLicenseReads = {
    tryReadLicense: async (organizationId: string) =>
      organizationId === LICENSED_ORGANIZATION_ID ? VALID_LICENSE_KEY : null,
    findOrganizationsWithLicense: () => candidates.findOrganizationsWithLicense(),
  };

  return { candidates, licenses };
}

function composeWithoutMutation() {
  return LicensingInfrastructureService.create({ processName: "the worker" }).withoutMutation({
    licenses: licenceRows().licenses,
  });
}

describe("licensing infrastructure composed without licence mutation", () => {
  /** @scenario "A process that composes no licence mutation still scans the licence rows" */
  it("accepts a key activated on an organization when no instance key is set", async () => {
    const app = await LicensingApp.create({
      dependencies: { gateway: createApiFixture<GatewayApi>() },
      members: { infrastructure: composeWithoutMutation(), isSaas: false, serviceVersion: "test" },
      config: TEST_LICENSING_CONFIG,
      resources: new ResourceScope(),
      secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
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
    candidates.deactivate(LICENSED_ORGANIZATION_ID);

    await expect(candidates.findOrganizationsWithLicense()).resolves.toEqual([]);
  });
});
