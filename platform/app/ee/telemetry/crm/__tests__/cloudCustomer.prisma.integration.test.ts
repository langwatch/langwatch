/**
 * @vitest-environment node
 *
 * The domain lookup against a real Postgres. It is a raw query, so the SQL and
 * the tenancy guard's verdict on it are only true if a database says so.
 *
 * @see ../cloudCustomer.prisma.ts
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaCloudCustomers } from "../cloudCustomer.prisma";

const RUN = `crm-${Date.now()}`;
const DOMAIN = `${RUN}.acme.test`;

describe("given a person on a company domain with a LangWatch Cloud account", () => {
  const customers = new PrismaCloudCustomers(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { name: `Ada ${RUN}`, email: `Ada@${DOMAIN.toUpperCase()}` },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { name: `Ada ${RUN}` } });
  });

  describe("when the domain is looked up", () => {
    /** @scenario "A company that already has an account with us is raised" */
    it("finds them whatever case the address was stored in", async () => {
      await expect(customers.hasAccountOnDomain(DOMAIN)).resolves.toBe(true);
      await expect(
        customers.hasAccountOnDomain(`  ${DOMAIN.toUpperCase()} `),
      ).resolves.toBe(true);
    });

    it("says no for a domain with no account behind it", async () => {
      await expect(
        customers.hasAccountOnDomain(`unknown-${RUN}.test`),
      ).resolves.toBe(false);
    });

    it("refuses a wildcard rather than matching every customer", async () => {
      // The value reaches SQL as a parameter, so a `%` is matched literally
      // and not as a pattern. Refusing it outright says so at the boundary.
      await expect(customers.hasAccountOnDomain("%")).resolves.toBe(false);
    });
  });
});
