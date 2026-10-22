/**
 * The token discard step's SQL against Postgres: it clears the provider tokens and leaves the rest
 * of the row, `updatedAt` included, as it was. It runs in a rolled-back transaction.
 * @see modules/auth/specs/provider-tokens.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  skipTenantCheck,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
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
    await connection.closeOnce();
  });

  describe("given an account row holding provider tokens, a scope and an update time", () => {
    /** @scenario "The token discard SQL leaves each account's other columns and update time alone" */
    it("nulls the three tokens and keeps the scope and update time", async () => {
      const prisma = connection.client;
      const rollback = new Error("rollback");
      const id = `${namespace}-account`;

      // The step is fleet-wide: lock writers out and roll back, so no other suite's row changes.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            ${skipTenantCheck({
              // A test lock over the whole table; `Account` has no tenant column.
              SKIP_TENANT_CHECK: true,
            })}
            LOCK TABLE "Account" IN SHARE ROW EXCLUSIVE MODE
          `;
          await tx.account.createMany({
            data: [
              {
                id,
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
              {
                id: `${id}-refresh-only`,
                userId: namespace,
                provider: "github",
                issuer: "https://github.com",
                providerAccountId: `${namespace}-refresh-only`,
                refresh_token: "ghr_only",
                updatedAt,
              },
              {
                id: `${id}-control`,
                userId: namespace,
                provider: "github",
                issuer: "https://github.com",
                providerAccountId: `${namespace}-control`,
                scope: "control-scope",
                updatedAt,
              },
            ],
          });
          const repository = PrismaAuthMigrationRepository.create(tx as PrismaClient);

          const wouldClear = await repository.discardProviderTokens({ dryRun: true });
          expect(wouldClear).toBeGreaterThanOrEqual(2);
          expect(await tx.account.findUniqueOrThrow({ where: { id } })).toMatchObject({
            access_token: "gho_access",
          });

          // The lock holds the table still: the run clears exactly what the dry run counted.
          expect(await repository.discardProviderTokens({ dryRun: false })).toBe(wouldClear);
          expect(await tx.account.findUniqueOrThrow({ where: { id } })).toMatchObject({
            access_token: null,
            refresh_token: null,
            id_token: null,
            scope: "read:user,user:email",
            updatedAt,
          });
          expect(
            await tx.account.findUniqueOrThrow({ where: { id: `${id}-refresh-only` } }),
          ).toMatchObject({ refresh_token: null, updatedAt });
          expect(
            await tx.account.findUniqueOrThrow({ where: { id: `${id}-control` } }),
          ).toMatchObject({ scope: "control-scope", updatedAt });
          expect(await repository.discardProviderTokens({ dryRun: true })).toBe(0);

          throw rollback;
        }),
      ).rejects.toThrow("rollback");

      expect(await prisma.account.count({ where: { userId: namespace } })).toBe(0);
    });
  });
});
