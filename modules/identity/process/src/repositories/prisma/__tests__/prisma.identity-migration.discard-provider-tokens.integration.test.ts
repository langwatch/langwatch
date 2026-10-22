/**
 * The credential token discard step's SQL against Postgres: it clears the provider tokens and
 * leaves passwords, scopes and `updatedAt` as they were, so the secret heal sees no new drift.
 * @see modules/identity/specs/provider-token-discard.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaIdentityMigrationRepository } from "../prisma.identity-migration.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const updatedAt = new Date("2026-01-02T03:04:05.000Z");

describe.skipIf(!DB_URL)("AccountCredential provider token discard", () => {
  const namespace = `cred-token-discard-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:credential-token-discard"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  afterAll(async () => {
    await prisma.accountCredential.deleteMany({ where: { userId: namespace } });
    await prisma.$disconnect();
  });

  describe("given a credential holding provider tokens and one holding only a password", () => {
    /** @scenario "The credential token discard clears tokens and leaves passwords and update times alone" */
    it("nulls the tokens and keeps every password, scope and update time", async () => {
      await prisma.accountCredential.createMany({
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
            id: `${namespace}-password`,
            userId: namespace,
            provider: "credential",
            password: "hashed-password",
            updatedAt,
          },
        ],
      });
      const repository = PrismaIdentityMigrationRepository.create(prisma);

      expect(await repository.discardProviderTokens({ dryRun: true })).toBeGreaterThanOrEqual(1);
      expect(await repository.discardProviderTokens({ dryRun: false })).toBeGreaterThanOrEqual(1);

      const rows = await prisma.accountCredential.findMany({
        where: { userId: namespace },
        orderBy: { id: "asc" },
      });
      expect(rows).toMatchObject([
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
    });
  });
});
