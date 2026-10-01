/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 * The licence key on the organization row: stored with its expiry, read back, removed.
 */
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaOrganizationLicenseRepository } from "../prisma.organization-license.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";

const RUN = `org-lic-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("the organization licence rows on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaOrganizationLicenseRepository.create(prisma);
  const organizationIds: string[] = [];

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  describe("given an organization with no licence", () => {
    it("stores a key with its expiry, reads it back and removes it", async () => {
      const organization = await prisma.organization.create({
        data: { name: `Licence ${RUN}`, slug: `--${RUN}` },
      });
      organizationIds.push(organization.id);
      const now = nowInstant().round({ smallestUnit: "millisecond" });
      const expiresAt = now.add({ hours: 24 * 30 });

      await expect(repository.organizationExists(organization.id)).resolves.toBe(true);
      await repository.storeLicense(organization.id, {
        licenseKey: "lic-key",
        expiresAt,
        validatedAt: now,
      });

      await expect(repository.getOrganizationLicense(organization.id)).resolves.toEqual({
        licenseKey: "lic-key",
      });
      const stored = await prisma.organization.findUniqueOrThrow({
        where: { id: organization.id },
        select: { licenseExpiresAt: true, licenseLastValidatedAt: true },
      });
      expect(stored.licenseExpiresAt?.getTime()).toBe(expiresAt.epochMilliseconds);
      expect(stored.licenseLastValidatedAt?.getTime()).toBe(now.epochMilliseconds);

      await repository.removeLicense(organization.id);
      await expect(repository.getOrganizationLicense(organization.id)).resolves.toEqual({
        licenseKey: null,
      });
    });
  });

  describe("given an id no organization holds", () => {
    it("says it does not exist", async () => {
      await expect(repository.organizationExists(`${RUN}-missing`)).resolves.toBe(false);
    });
  });
});
