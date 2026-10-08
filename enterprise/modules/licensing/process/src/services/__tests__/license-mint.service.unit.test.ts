/**
 * The mint's two writes, the registry row and the license on the organization, and the
 * compensation when the second fails.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { MemoryOrganizationLicenseRepository } from "../../repositories/memory/memory.organization-license.repository.ts";
import { LicenseMintService } from "../license-mint.service.ts";
import { LicenseRegistryService } from "../license-registry.service.ts";
import { OrganizationLicenseWriterService } from "../organization-license-writer.service.ts";

/** A collaborator the mint must never reach; any call fails the test. */
function untouched<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_, member) => () => {
      throw new Error(`unexpected call to ${String(member)}`);
    },
  });
}

/** Organizations as a store: a write to one that is gone fails as the real one does. */
class OrganizationStore implements Pick<
  OrganizationApi,
  "findProvisioningSummary" | "setLicense" | "clearLicense"
> {
  readonly licenses = new Map<string, { licenseKey: string; expiresAt: Instant }>();
  readonly #rows = new Map<string, OrganizationProvisioningSummary>();

  constructor(private readonly goneBeforeWrite: boolean) {
    this.#rows.set("org-acme", {
      id: "org-acme",
      name: "ACME",
      slug: "acme",
      createdAt: nowInstant(),
    });
  }

  async findProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    const row = this.#rows.get(organizationId) ?? null;
    if (this.goneBeforeWrite) this.#rows.delete(organizationId);
    return row;
  }

  async setLicense({
    organizationId,
    licenseKey,
    expiresAt,
  }: {
    organizationId: string;
    licenseKey: string;
    expiresAt: Instant;
  }): Promise<void> {
    if (!this.#rows.has(organizationId)) throw new OrganizationNotFoundError();
    this.licenses.set(organizationId, { licenseKey, expiresAt });
  }

  async clearLicense({ organizationId }: { organizationId: string }): Promise<void> {
    this.licenses.delete(organizationId);
  }
}

function harness({ goneBeforeWrite }: { goneBeforeWrite: boolean }) {
  const repository = MemoryIssuedLicenseRepository.create();
  const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
  const generation = LicenseGenerationService.create(cryptography);
  const registry = LicenseRegistryService.create({
    repository,
    organizations: untouched(),
    managedKeys: untouched(),
    contractBudgets: untouched(),
    cryptography,
    generation,
    signingKey: () => TEST_PRIVATE_KEY,
    now: () => Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
  });
  const organizations = new OrganizationStore(goneBeforeWrite);
  const licenseRows = MemoryOrganizationLicenseRepository.create(new Map([["org-acme", null]]));
  const mint = LicenseMintService.create({
    licenses: {
      generateLicenseKey: async (input) =>
        generation.generate({ ...input, privateKey: TEST_PRIVATE_KEY }),
      recordIssuedLicense: (input) => registry.record(input),
    },
    organizations,
    storage: OrganizationLicenseWriterService.create({ licenses: licenseRows, organizations }),
    registry: repository,
  });
  return { mint, repository, organizations, licenseRows };
}

async function registryRows(repository: MemoryIssuedLicenseRepository) {
  return repository.findAllByOrganization("org-acme");
}

describe("LicenseMintService", () => {
  describe("given the license is minted for an organization", () => {
    /** @scenario "A license minted by the command line script is recorded" */
    it("records the registry row and writes the license onto the organization", async () => {
      const { mint, repository, organizations, licenseRows } = harness({
        goneBeforeWrite: false,
      });

      const result = await mint.applyToOrganization({
        organizationId: "org-acme",
        planType: "ENTERPRISE",
      });

      const rows = await registryRows(repository);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        licenseId: result.licenseId,
        organizationId: "org-acme",
        source: "SCRIPT",
        email: "acme@local.test",
        maxMembers: 50,
      });
      expect(organizations.licenses.get("org-acme")?.expiresAt.toString()).toBe(
        Temporal.Instant.from(result.expiresAt).toString(),
      );
      expect((await licenseRows.getOrganizationLicense("org-acme")).licenseKey).toBe(
        organizations.licenses.get("org-acme")?.licenseKey,
      );
    });
  });

  describe("given writing the license onto the organization fails", () => {
    /** @scenario "A minted license whose organization write fails leaves no registry row" */
    it("deletes the registry row it wrote and fails the mint", async () => {
      const { mint, repository, organizations, licenseRows } = harness({ goneBeforeWrite: true });

      await expect(
        mint.applyToOrganization({ organizationId: "org-acme", planType: "ENTERPRISE" }),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);

      expect(await registryRows(repository)).toEqual([]);
      expect(organizations.licenses.size).toBe(0);
      await expect(licenseRows.getOrganizationLicense("org-acme")).resolves.toEqual({
        licenseKey: null,
      });
    });
  });
});
