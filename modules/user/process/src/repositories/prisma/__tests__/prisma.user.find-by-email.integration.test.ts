/**
 * @vitest-environment node
 * The lookup by address against a real Postgres ignores case, as main's reads do.
 * @see modules/user/specs/user.feature
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
const RUN = `find-by-email-${randomUUID()}`;
const STORED = `Ada@${RUN}.Example.test`;

describe.skipIf(!databaseUrl)("given an account stored with capitals in its address", () => {
  let connection: PrismaConnection;
  let userId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-find-by-email:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const row = await connection.client.user.create({ data: { name: "Ada", email: STORED } });
    userId = row.id;
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  describe("when it is looked up by the lowercased address", () => {
    it("finds that account", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await expect(users.findByEmail(STORED.toLowerCase())).resolves.toMatchObject({ id: userId });
    });

    it("finds nobody for an address nobody holds", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await expect(users.findByEmail(`nobody@${RUN}.example.test`)).resolves.toBeNull();
    });
  });
});
