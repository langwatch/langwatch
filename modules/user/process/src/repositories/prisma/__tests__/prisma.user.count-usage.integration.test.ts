/**
 * @vitest-environment node
 * The usage report's email domains against a real Postgres: the fold has to
 * group what a real directory holds, and the tenancy guard has to admit it.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaUserRepository } from "../prisma.user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `usage-${randomUUID()}`;
const DOMAIN = `${RUN}.acme.test`;
const OTHER = `${RUN}.other.test`;

describe.skipIf(!databaseUrl)("given users on two company domains", () => {
  let connection: PrismaConnection;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:usage-report:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    await connection.client.user.createMany({
      data: [
        { name: "Ada", email: `ada@${DOMAIN}` },
        // Mixed case and padding, because a real directory has both and the
        // report must not carry one company twice under two spellings.
        { name: "Grace", email: `  Grace@${DOMAIN.toUpperCase()}  ` },
        { name: "Kay", email: `kay@${OTHER}` },
      ],
    });
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  describe("when the domains are counted", () => {
    /** @scenario "Company identity travels as aggregated domains, never an address" */
    it("counts them in Postgres and returns no address", async () => {
      const { emailDomains } = await PrismaUserRepository.create({
        prisma: connection.client,
      }).countUsage();

      expect(emailDomains[DOMAIN]).toBe(2);
      expect(emailDomains[OTHER]).toBe(1);
      expect(JSON.stringify(emailDomains)).not.toContain("ada@");
    });
  });
});
