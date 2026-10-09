/**
 * @vitest-environment node
 * The licence write and clear on the memory organization store, as the Prisma twin does them.
 * @see modules/organization/specs/organization-service.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");
const expiresAt = Temporal.Instant.from("2027-09-01T00:00:00Z");
const validatedAt = Temporal.Instant.from("2026-10-08T12:00:00Z");

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  memory.organizations.set("org_acme", {
    id: "org_acme",
    name: "ACME",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: created,
    updatedAt: created,
  });
  return { memory, repository: MemoryOrganizationRepository.create({ memory }) };
}

const stored = (memory: MemoryOrganizationDatabase) => {
  const row = memory.organizations.get("org_acme");
  return {
    license: row?.license,
    licenseExpiresAt: row?.licenseExpiresAt,
    licenseLastValidatedAt: row?.licenseLastValidatedAt,
  };
};

describe("MemoryOrganizationRepository licence write", () => {
  describe("given a memory organization", () => {
    describe("when a licence is set with its expiry and the moment it was validated", () => {
      /** @scenario "The memory organization store sets and clears a licence the same way" */
      it("stores all three, clears all three, and refuses an unknown organization", async () => {
        const { memory, repository } = seeded();

        await repository.setLicense({
          organizationId: "org_acme",
          licenseKey: "key-1",
          expiresAt,
          validatedAt,
        });
        expect(stored(memory)).toEqual({
          license: "key-1",
          licenseExpiresAt: expiresAt,
          licenseLastValidatedAt: validatedAt,
        });

        await repository.setLicense({
          organizationId: "org_acme",
          licenseKey: "key-2",
          expiresAt,
          validatedAt: null,
        });
        expect(stored(memory).licenseLastValidatedAt).toBeNull();

        await repository.clearLicense({ organizationId: "org_acme" });
        expect(stored(memory)).toEqual({
          license: null,
          licenseExpiresAt: null,
          licenseLastValidatedAt: null,
        });

        await expect(
          repository.setLicense({
            organizationId: "org_none",
            licenseKey: "key-1",
            expiresAt,
            validatedAt: null,
          }),
        ).rejects.toMatchObject({ code: "organization_not_found" });
        await expect(repository.clearLicense({ organizationId: "org_none" })).rejects.toMatchObject(
          { code: "organization_not_found" },
        );
      });
    });
  });
});
