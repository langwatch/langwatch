/**
 * @vitest-environment node
 * Addresses are stored lower-cased: the lookup is a plain match on the unique index. The address
 * step's read and guarded write against a real Postgres; it never runs whole on a shared database.
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
const LOWERED = STORED.toLowerCase();

describe.skipIf(!databaseUrl)("given an account stored with capitals in its address", () => {
  let connection: PrismaConnection;
  let users: PrismaUserRepository;
  let userId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-find-by-email:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    users = PrismaUserRepository.create({ prisma: connection.client });
    const row = await connection.client.user.create({ data: { name: "Ada", email: STORED } });
    userId = row.id;
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({
      where: { email: { contains: RUN, mode: "insensitive" } },
    });
    await connection.client.$disconnect();
  });

  describe("when it is looked up by address", () => {
    /** @scenario "A mixed-case sign-in still finds the account" */
    it("matches the stored address exactly, never case aside", async () => {
      await expect(users.findByEmail(STORED)).resolves.toMatchObject([{ id: userId }]);
      await expect(users.findByEmail(LOWERED)).resolves.toEqual([]);
      await expect(users.findByEmail(`nobody@${RUN}.example.test`)).resolves.toEqual([]);
    });
  });

  describe("when the address step rewrites it", () => {
    /** @scenario "The address step never overwrites a save made during its pass" */
    it("writes only while the row still holds the address it read", async () => {
      await expect(
        users.replaceAddress({ id: userId, from: STORED.toUpperCase(), to: LOWERED }),
      ).resolves.toBe("changed");
      await expect(users.findById(userId)).resolves.toMatchObject({ email: STORED });
    });

    /** @scenario "A case-only duplicate is left as it is and reported" */
    it("answers taken, changing neither row, when another account holds the lower-cased form", async () => {
      const twin = await connection.client.user.create({ data: { name: "Twin", email: LOWERED } });

      await expect(users.replaceAddress({ id: userId, from: STORED, to: LOWERED })).resolves.toBe(
        "taken",
      );
      await expect(users.findById(userId)).resolves.toMatchObject({ email: STORED });
      await connection.client.user.delete({ where: { id: twin.id } });
    });

    /** @scenario "The address step lower-cases every stored address" */
    it("reads it as not lower-case, lower-cases it, and the plain lookup then finds it", async () => {
      const mixed = await users.findMixedCaseAddressPage({ afterId: null, limit: 10_000 });
      expect(mixed).toContainEqual({ id: userId, email: STORED });
      await expect(users.replaceAddress({ id: userId, from: STORED, to: LOWERED })).resolves.toBe(
        "replaced",
      );
      await expect(users.findByEmail(LOWERED)).resolves.toMatchObject([{ id: userId }]);
      await expect(users.findById(userId)).resolves.toMatchObject({ email: LOWERED });
    });
  });
});
