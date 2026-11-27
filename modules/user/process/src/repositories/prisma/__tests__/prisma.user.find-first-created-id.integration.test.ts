/**
 * @vitest-environment node
 * The install's first-created account against a real Postgres. Each case runs in a transaction
 * that rolls back, so concurrent runs on the shared database never see each other's rows.
 * Spec: modules/user/specs/user.feature
 */
import { randomInt, randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaUserRepository, type UserDatabase } from "../prisma.user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `first-${randomUUID()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Dated far before any real account, at an offset of this run's own. */
const BASE_MS = Date.UTC(1000, 0, 1) + randomInt(1, 300_000) * DAY_MS;

class RolledBack extends Error {}

describe.skipIf(!databaseUrl)("given accounts created one after another", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-first-created:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    await connection.client.$disconnect();
  });

  /** Runs the case inside a transaction and rolls it back, whatever the case did. */
  async function rolledBack(
    run: (input: { tx: Prisma.TransactionClient; users: PrismaUserRepository }) => Promise<void>,
  ): Promise<void> {
    await expect(
      connection.client.$transaction(async (tx) => {
        // The reads go through the transaction's delegates; this read opens no transaction itself.
        const database: UserDatabase = {
          user: tx.user,
          account: tx.account,
          passkey: tx.passkey,
          userErasure: tx.userErasure,
          $queryRaw: tx.$queryRaw.bind(tx),
          $transaction: connection.client.$transaction.bind(connection.client),
        };
        const users = PrismaUserRepository.create({ prisma: database });
        await run({ tx, users });
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  }

  async function account(tx: Prisma.TransactionClient, label: string, dayOffset: number) {
    return tx.user.create({
      data: {
        name: `${label} ${RUN}`,
        email: `${label}@${RUN}.acme.test`,
        createdAt: new Date(BASE_MS + dayOffset * DAY_MS),
      },
    });
  }

  /** @scenario "The install's first-created account is answered by id" */
  it("answers the earliest-created account, and still it once deactivated", async () => {
    await rolledBack(async ({ tx, users }) => {
      const first = await account(tx, "first", 0);
      await account(tx, "later", 1);
      await expect(users.findFirstCreatedId()).resolves.toBe(first.id);

      await tx.user.update({
        where: { id: first.id },
        data: { deactivatedAt: new Date(BASE_MS + 2 * DAY_MS) },
      });
      await expect(users.findFirstCreatedId()).resolves.toBe(first.id);
    });
  });

  /** @scenario "An erased first account leaves no account first-created" */
  it("answers none once an account created before every remaining one was erased", async () => {
    await rolledBack(async ({ tx, users }) => {
      const first = await account(tx, "first", 0);
      await tx.userErasure.create({ data: { accountCreatedAt: new Date(BASE_MS + DAY_MS) } });
      await expect(users.findFirstCreatedId()).resolves.toBe(first.id);

      await tx.userErasure.create({ data: { accountCreatedAt: new Date(BASE_MS - DAY_MS) } });
      await expect(users.findFirstCreatedId()).resolves.toBeNull();
    });
  });
});
