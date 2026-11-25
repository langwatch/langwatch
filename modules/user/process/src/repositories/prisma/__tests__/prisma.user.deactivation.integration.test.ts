/**
 * @vitest-environment node
 * Deactivating platform operators against a real Postgres: two racing requests never both pass.
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
const RUN = `deactivation-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given two active platform operators", () => {
  let connection: PrismaConnection;
  let first: string;
  let second: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-deactivation:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    first = (await connection.client.user.create({ data: { email: `first@${RUN}.test` } })).id;
    second = (await connection.client.user.create({ data: { email: `second@${RUN}.test` } })).id;
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  describe("when both are deactivated at once", () => {
    /** @scenario "Two operators deactivated at once cannot leave none active" */
    it("deactivates one and refuses the other", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });
      // The database's clock, as the service stamps it.
      const at = await users.readClock();

      const outcomes = await Promise.all([
        users.deactivateWhileOthersActive({ id: first, deactivatedAt: at, others: [second] }),
        users.deactivateWhileOthersActive({ id: second, deactivatedAt: at, others: [first] }),
      ]);

      expect(outcomes.map(({ outcome }) => outcome).toSorted()).toEqual([
        "deactivated",
        "none_active",
      ]);
      const active = await connection.client.user.count({
        where: { id: { in: [first, second] }, deactivatedAt: null },
      });
      expect(active).toBe(1);
    });
  });
});
