import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
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
    const candidates = MemoryOrganizationLicenseRepository.create(
      new Map([[LICENSED_ORGANIZATION_ID, null]]),
    );

    await expect(candidates.findOrganizationsWithLicense()).resolves.toEqual([]);
  });
});

function composeWithStorage(licenses: MemoryOrganizationLicenseRepository) {
  const writes: unknown[] = [];
  const { repository } = LicensingInfrastructureService.create({ role: "api" }).withStorage({
    licenses,
    organizations: createApiFixture<OrganizationApi>({
      setLicense: async (input) => {
        writes.push({ set: input });
      },
      clearLicense: async (input) => {
        writes.push({ clear: input });
      },
    }),
    getMemberCount: async () => 0,
    getMembersLiteCount: async () => 0,
  });
  return { repository, writes };
}

describe("licensing infrastructure composed with licence storage", () => {
  /** @scenario "A stored licence lands on licensing's own row and on organization's columns" */
  it("keeps an activation and a removal on its own row and tells organization each", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(new Map([["org_acme", null]]));
    const { repository, writes } = composeWithStorage(licenses);
    const expiresAt = Temporal.Instant.from("2027-01-01T00:00:00Z");
    const validatedAt = Temporal.Instant.from("2026-10-08T12:00:00Z");

    await repository.storeLicense("org_acme", { licenseKey: "key", expiresAt, validatedAt });
    const stored = await repository.getOrganizationLicense("org_acme");
    await repository.removeLicense("org_acme");

    expect(stored).toEqual({ licenseKey: "key" });
    await expect(repository.getOrganizationLicense("org_acme")).resolves.toEqual({
      licenseKey: null,
    });
    expect(writes).toEqual([
      { set: { organizationId: "org_acme", licenseKey: "key", expiresAt, validatedAt } },
      { clear: { organizationId: "org_acme" } },
    ]);
  });

  /** @scenario "A stored licence lands on licensing's own row and on organization's columns" */
  it("keeps nothing when organization refuses the write", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(new Map([["org_acme", null]]));
    const { repository } = LicensingInfrastructureService.create({ role: "api" }).withStorage({
      licenses,
      organizations: createApiFixture<OrganizationApi>({
        setLicense: async () => {
          throw new OrganizationNotFoundError();
        },
      }),
      getMemberCount: async () => 0,
      getMembersLiteCount: async () => 0,
    });
    const expiresAt = Temporal.Instant.from("2027-01-01T00:00:00Z");

    await expect(
      repository.storeLicense("org_acme", { licenseKey: "key", expiresAt, validatedAt: null }),
    ).rejects.toMatchObject({ code: "organization_not_found" });
    await expect(
      licenses.findLicensePairs({ afterOrganizationId: null, limit: 10 }),
    ).resolves.toMatchObject([{ organizationId: "org_acme", own: null }]);
    await expect(repository.getOrganizationLicense("org_acme")).resolves.toEqual({
      licenseKey: null,
    });
  });

  /** @scenario "A cleared licence is never read back from organization's columns" */
  it("reads no key once removed, though organization's columns still hold one", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(
      new Map([[LICENSED_ORGANIZATION_ID, VALID_LICENSE_KEY]]),
    );
    const { repository } = composeWithStorage(licenses);

    await repository.removeLicense(LICENSED_ORGANIZATION_ID);

    await expect(repository.getOrganizationLicense(LICENSED_ORGANIZATION_ID)).resolves.toEqual({
      licenseKey: null,
    });
    await expect(repository.findOrganizationsWithLicense()).resolves.toEqual([]);
  });

  /** @scenario "A licence activated before the move is read from organization's columns until it is copied" */
  it("answers a key only organization's columns hold", async () => {
    const { repository } = composeWithStorage(
      MemoryOrganizationLicenseRepository.create(
        new Map([[LICENSED_ORGANIZATION_ID, VALID_LICENSE_KEY]]),
      ),
    );

    await expect(repository.getOrganizationLicense(LICENSED_ORGANIZATION_ID)).resolves.toEqual({
      licenseKey: VALID_LICENSE_KEY,
    });
    await expect(repository.findOrganizationsWithLicense()).resolves.toEqual([
      { organizationId: LICENSED_ORGANIZATION_ID, licenseKey: VALID_LICENSE_KEY },
    ]);
  });
});
