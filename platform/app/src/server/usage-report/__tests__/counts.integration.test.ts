/**
 * @vitest-environment node
 *
 * The email-domain aggregation against a real Postgres.
 *
 * It is a raw query, so two things are only true if a database says so: that
 * the SQL parses and groups the way the report expects, and that the tenancy
 * guard admits it. A unit test with a stubbed client proves neither.
 *
 * @see ../counts.ts
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { userEmailDomains } from "../counts";

const RUN = `usage-${Date.now()}`;
const DOMAIN = `${RUN}.acme.test`;
const OTHER = `${RUN}.other.test`;

describe("given users on two company domains", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        { name: "Ada", email: `ada@${DOMAIN}` },
        // Mixed case and padding, because a real directory has both and the
        // report must not carry the same company twice under two spellings.
        { name: "Grace", email: `  Grace@${DOMAIN.toUpperCase()}  ` },
        { name: "Kay", email: `kay@${OTHER}` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        name: { in: ["Ada", "Grace", "Kay"] },
        email: { contains: RUN },
      },
    });
  });

  describe("when the domains are counted", () => {
    /** @scenario "Company identity travels as aggregated domains, never an address" */
    it("counts them in Postgres and returns no address", async () => {
      const counts = await userEmailDomains(prisma);

      expect(counts[DOMAIN]).toBe(2);
      expect(counts[OTHER]).toBe(1);
      expect(JSON.stringify(counts)).not.toContain("ada@");
    });
  });
});
