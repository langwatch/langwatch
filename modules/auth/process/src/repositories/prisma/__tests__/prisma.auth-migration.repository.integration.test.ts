/**
 * The token discard step's SQL against Postgres: it clears the provider tokens and leaves the rest
 * of the row, `updatedAt` included, as it was.
 * @see modules/auth/specs/provider-tokens.feature
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

import { PrismaAuthMigrationRepository } from "../prisma.auth-migration.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-auth-token-discard-${randomUUID()}`;
const updatedAt = new Date("2026-01-02T03:04:05.000Z");

describe.skipIf(!databaseUrl)("Account provider token discard", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:token-discard"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.account.deleteMany({ where: { userId: namespace } });
    await connection.closeOnce();
  });

  describe("given an account row holding provider tokens, a scope and an update time", () => {
    /** @scenario "The token discard SQL leaves each account's other columns and update time alone" */
    it("nulls the three tokens and keeps the scope and update time", async () => {
      const prisma = connection.client;
      await prisma.account.create({
        data: {
          id: `${namespace}-account`,
          userId: namespace,
          provider: "github",
          issuer: "https://github.com",
          providerAccountId: `${namespace}-gh`,
          access_token: "gho_access",
          refresh_token: "ghr_refresh",
          id_token: "header.payload.signature",
          scope: "read:user,user:email",
          updatedAt,
        },
      });
      const repository = PrismaAuthMigrationRepository.create(prisma);

      expect(await repository.discardProviderTokens({ dryRun: true })).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id: `${namespace}-account` } }),
      ).toMatchObject({ access_token: "gho_access" });

      expect(await repository.discardProviderTokens({ dryRun: false })).toBeGreaterThanOrEqual(1);

      expect(
        await prisma.account.findUniqueOrThrow({ where: { id: `${namespace}-account` } }),
      ).toMatchObject({
        access_token: null,
        refresh_token: null,
        id_token: null,
        scope: "read:user,user:email",
        updatedAt,
      });
      expect(await repository.discardProviderTokens({ dryRun: true })).toBe(0);
    });
  });
});
