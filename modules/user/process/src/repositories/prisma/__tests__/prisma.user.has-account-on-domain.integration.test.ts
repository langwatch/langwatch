/**
 * @vitest-environment node
 * Whether a company already has an account with us, against a real Postgres: the match is on
 * the part of the address after the `@`, and only a yes or no leaves the module.
 * Spec: specs/self-hosting/connected-services/self-hosted-lead-signals.feature
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
const RUN = `crm-${randomUUID()}`;
const DOMAIN = `${RUN}.acme.test`;

describe.skipIf(!databaseUrl)("given a person on a company domain with an account", () => {
  let connection: PrismaConnection;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-domain:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    await connection.client.user.create({
      data: { name: `Ada ${RUN}`, email: `Ada@${DOMAIN.toUpperCase()}` },
    });
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  describe("when the domain is looked up", () => {
    it("finds them whatever case the address was stored in", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await expect(users.hasAccountOnDomain(DOMAIN)).resolves.toBe(true);
    });

    it("says no for a domain with no account behind it", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await expect(users.hasAccountOnDomain(`unknown-${RUN}.test`)).resolves.toBe(false);
    });
  });
});
