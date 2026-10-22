/**
 * The credential token discard step's SQL against Postgres, in a rolled-back transaction: it clears
 * the provider tokens and leaves passwords, scopes and `updatedAt` as they were.
 * @see modules/identity/specs/provider-token-discard.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  skipTenantCheck,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaIdentityMigrationRepository } from "../prisma.identity-migration.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const updatedAt = new Date("2026-01-02T03:04:05.000Z");

describe.skipIf(!DB_URL)("AccountCredential provider token discard", () => {
  const namespace = `cred-token-discard-${nanoid(8)}`;
  let connection: PrismaConnection;

  beforeAll(() => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:identity:test:credential-token-discard"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.closeOnce();
  });

  describe("given a credential holding provider tokens and one holding only a password", () => {
    /** @scenario "The credential token discard clears tokens and leaves passwords and update times alone" */
    it("nulls the tokens and keeps every password, scope and update time", async () => {
      const prisma = connection.client as PrismaClient;
      const rollback = new Error("rollback");

      // The step is fleet-wide: lock writers out and roll back, so no other suite's row changes.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            ${skipTenantCheck({
              // A test lock over the whole table; the user is the key.
              SKIP_TENANT_CHECK: true,
            })}
            LOCK TABLE "AccountCredential" IN SHARE ROW EXCLUSIVE MODE
          `;
          await tx.accountCredential.createMany({
            data: [
              {
                id: `${namespace}-oauth`,
                userId: namespace,
                provider: "auth0",
                accessToken: "auth0-access",
                refreshToken: "auth0-refresh",
                idToken: "header.payload.signature",
                scope: "openid profile email",
                updatedAt,
              },
              {
                id: `${namespace}-id-only`,
                userId: namespace,
                provider: "okta",
                idToken: "header.payload.signature",
                updatedAt,
              },
              {
                id: `${namespace}-password`,
                userId: namespace,
                provider: "credential",
                password: "hashed-password",
                updatedAt,
              },
            ],
          });
          const repository = PrismaIdentityMigrationRepository.create(tx as PrismaClient);

          const wouldClear = await repository.discardProviderTokens({ dryRun: true });
          expect(wouldClear).toBeGreaterThanOrEqual(2);
          // The lock holds the table still: the run clears exactly what the dry run counted.
          expect(await repository.discardProviderTokens({ dryRun: false })).toBe(wouldClear);

          const rows = await tx.accountCredential.findMany({
            where: { userId: namespace },
            orderBy: { id: "asc" },
          });
          expect(rows).toMatchObject([
            { id: `${namespace}-id-only`, idToken: null, updatedAt },
            {
              id: `${namespace}-oauth`,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              scope: "openid profile email",
              updatedAt,
            },
            { id: `${namespace}-password`, password: "hashed-password", updatedAt },
          ]);
          expect(await repository.discardProviderTokens({ dryRun: false })).toBe(0);

          throw rollback;
        }),
      ).rejects.toThrow("rollback");

      expect(await prisma.accountCredential.count({ where: { userId: namespace } })).toBe(0);
    });
  });
});
