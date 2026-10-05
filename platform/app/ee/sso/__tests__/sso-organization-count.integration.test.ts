/**
 * @vitest-environment node
 *
 * How many organizations the installation holds, read from a real Postgres.
 * The count is cross-organization on purpose, so it has to get past the
 * multitenancy guard on the Prisma client as it is wired in production.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  LicenseDomainClaimAuthority,
  PrismaOrganizationCount,
} from "../sso-self-serve-adapters";

const RUN = `sso-org-count-${Date.now()}`;

describe("the installation's organization count on Postgres", () => {
  const organizationIds: string[] = [];
  const count = new PrismaOrganizationCount(prisma);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
  });

  describe("when an organization is added", () => {
    it("counts it", async () => {
      const before = await count.countOrganizations();

      const organization = await prisma.organization.create({
        data: { name: `ACME ${RUN}`, slug: RUN },
      });
      organizationIds.push(organization.id);

      expect(await count.countOrganizations()).toBe(before + 1);
    });
  });

  describe("when the installation holds more than one organization", () => {
    it("does not report a single organization", async () => {
      const other = await prisma.organization.create({
        data: { name: `ACME second ${RUN}`, slug: `${RUN}-second` },
      });
      organizationIds.push(other.id);
      const authority = new LicenseDomainClaimAuthority({
        organizations: count,
        isHosted: () => false,
      });

      expect(await count.countOrganizations()).toBeGreaterThan(1);
      expect(await authority.hostsSingleOrganization()).toBe(false);
    });
  });
});
