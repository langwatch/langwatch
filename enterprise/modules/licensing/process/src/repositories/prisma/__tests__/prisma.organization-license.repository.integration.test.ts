/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 * The licence key on the organization row, read; organization owns the write.
 */
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

  describe("given an organization carrying a licence key", () => {
    it("reads the key back, scans it, and answers no key once organization clears it", async () => {
      const organization = await prisma.organization.create({
        data: { name: `Licence ${RUN}`, slug: `--${RUN}`, license: "lic-key" },
      });
      organizationIds.push(organization.id);

      await expect(repository.organizationExists(organization.id)).resolves.toBe(true);
      await expect(repository.getOrganizationLicense(organization.id)).resolves.toEqual({
        licenseKey: "lic-key",
      });
      await expect(repository.findOrganizationsWithLicense()).resolves.toContainEqual({
        organizationId: organization.id,
        licenseKey: "lic-key",
      });

      await prisma.organization.update({ where: { id: organization.id }, data: { license: null } });
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
