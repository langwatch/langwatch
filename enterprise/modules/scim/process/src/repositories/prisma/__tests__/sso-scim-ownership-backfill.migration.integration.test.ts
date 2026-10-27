// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The SSO and SCIM ownership migration, run whole in a throwaway schema inside
 * a rolled-back transaction. Ported from main's sso-scim-ownership-backfill test.
 * @see specs/identity/sso-credential-enforcement.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:scim:test:ownership-backfill"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const MIGRATION_SQL = readFileSync(
  join(
    import.meta.dirname,
    "../../../../../../../../packages/prisma-client/prisma/migrations",
    "20260918171006_sso_scim_ownership_backfill/migration.sql",
  ),
  "utf8",
);

const PRE_UPGRADE_TABLES = `
  CREATE TABLE "SsoConnection" ("id" text PRIMARY KEY, "organizationId" text NOT NULL, "state" text NOT NULL, "verifiedDomains" text[] NOT NULL);
  CREATE TABLE "ScimDirectoryUser" ("connectionId" text NOT NULL, "userId" text NOT NULL);
  CREATE INDEX "ScimDirectoryUser_userId_idx" ON "ScimDirectoryUser" ("userId");
  CREATE TABLE "ScimExternalId" ("connectionId" text NOT NULL, "externalId" text NOT NULL, "userId" text NOT NULL);
  CREATE INDEX "ScimExternalId_userId_idx" ON "ScimExternalId" ("userId");
  CREATE TABLE "SsoVerifiedDomain" ("domain" text PRIMARY KEY, "organizationId" text NOT NULL);
  CREATE TABLE "SsoVerifiedDomainHolder" ("domain" text NOT NULL, "connectionId" text NOT NULL, "organizationId" text NOT NULL, PRIMARY KEY ("domain", "connectionId"));
  INSERT INTO "SsoConnection" VALUES ('active', 'acme', 'ACTIVE', ARRAY['acme.test']), ('replacement', 'acme', 'VERIFIED', ARRAY['acme.test']), ('retired', 'old', 'TORN_DOWN', ARRAY['old.test']);
  INSERT INTO "ScimDirectoryUser" VALUES ('active', 'person');
  INSERT INTO "ScimExternalId" VALUES ('active', 'external', 'person');
`;

type Tx = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

class RollBack extends Error {}

/** Runs `body` in a fresh schema seeded as before the upgrade, then rolls everything back. */
async function inPreUpgradeSchema({ body }: { body: (tx: Tx) => Promise<void> }): Promise<void> {
  const schema = `migration_${generate("migration")
    .toString()
    .replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(PRE_UPGRADE_TABLES);
      await body(tx);
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}

/** A raw query Postgres refused, matched on the driver's original code. */
const refusedWith = (cause: Record<string, unknown>) => ({
  code: "P2010",
  meta: { driverAdapterError: { cause } },
});

const rows = ({ tx, sql }: { tx: Tx; sql: string }) => tx.$queryRawUnsafe<unknown[]>(sql);

describe.skipIf(!databaseUrl)("SSO and SCIM ownership upgrade", () => {
  /** @scenario "An upgrade restores verified domain routes and tenant-owned directory identities" */
  it("backfills tenants and holders, preserving existing owners and excluding retired connections", async () => {
    await inPreUpgradeSchema({
      body: async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "SsoVerifiedDomain" VALUES ('acme.test', 'acme'); INSERT INTO "SsoVerifiedDomainHolder" VALUES ('acme.test', 'active', 'acme');`,
        );
        await tx.$executeRawUnsafe(MIGRATION_SQL);
        expect(await rows({ tx, sql: 'SELECT * FROM "SsoVerifiedDomain"' })).toEqual([
          { domain: "acme.test", organizationId: "acme" },
        ]);
        expect(
          await rows({
            tx,
            sql: 'SELECT "connectionId" FROM "SsoVerifiedDomainHolder" ORDER BY "connectionId"',
          }),
        ).toEqual([{ connectionId: "active" }, { connectionId: "replacement" }]);
        expect(await rows({ tx, sql: 'SELECT "organizationId" FROM "ScimDirectoryUser"' })).toEqual(
          [{ organizationId: "acme" }],
        );
        expect(await rows({ tx, sql: 'SELECT "organizationId" FROM "ScimExternalId"' })).toEqual([
          { organizationId: "acme" },
        ]);
      },
    });
  });

  it("creates a missing verified-domain owner", async () => {
    await inPreUpgradeSchema({
      body: async (tx) => {
        await tx.$executeRawUnsafe(MIGRATION_SQL);
        expect(await rows({ tx, sql: 'SELECT * FROM "SsoVerifiedDomain"' })).toEqual([
          { domain: "acme.test", organizationId: "acme" },
        ]);
      },
    });
  });

  it("refuses cross-tenant domain collisions", async () => {
    await expect(
      inPreUpgradeSchema({
        body: async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "SsoConnection" VALUES ('foreign', 'globex', 'ACTIVE', ARRAY['acme.test'])`,
          );
          await tx.$executeRawUnsafe(MIGRATION_SQL);
        },
      }),
    ).rejects.toMatchObject(refusedWith({ originalCode: "23505" }));
  });

  it("refuses to guess the tenant of an orphaned directory identity, naming its connection", async () => {
    await expect(
      inPreUpgradeSchema({
        body: async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "ScimExternalId" VALUES ('missing', 'orphan', 'person')`,
          );
          await tx.$executeRawUnsafe(MIGRATION_SQL);
        },
      }),
    ).rejects.toMatchObject(
      refusedWith({
        originalCode: "P0001",
        originalMessage: expect.stringContaining("First 20: missing"),
      }),
    );
  });
});
