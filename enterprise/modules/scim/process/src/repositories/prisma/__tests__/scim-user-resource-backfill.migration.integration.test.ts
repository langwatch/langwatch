// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The `scim_user_resources` migration's backfill, run over seeded directory
 * claims in real Postgres: one resource per organization and user pair, and
 * no account is reactivated or rewritten.
 * @see enterprise/modules/scim/specs/scim-connection-sync.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:scim:test:user-resource-backfill"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const MIGRATION_SQL = readFileSync(
  join(
    import.meta.dirname,
    "../../../../../../../../packages/prisma-client/prisma/migrations",
    "20260918171008_scim_user_resources/migration.sql",
  ),
  "utf8",
);

/** The migration's backfill statement, limited to the organizations this test seeded. */
function backfillScopedTo({ organizationIds }: { organizationIds: string[] }): string {
  const statement = MIGRATION_SQL.match(/INSERT INTO "ScimUserResource"[\s\S]*?;/)?.[0];
  if (!statement) throw new Error("the migration no longer carries its backfill statement");
  const accountJoin = `JOIN "User" AS account ON account."id" = claims."userId"`;
  if (!statement.includes(accountJoin))
    throw new Error("the backfill no longer joins the accounts");
  const listed = organizationIds.map((id) => `'${id}'`).join(", ");

  return statement.replace(
    accountJoin,
    `${accountJoin} WHERE claims."organizationId" IN (${listed})`,
  );
}

describe.skipIf(!databaseUrl)("the SCIM user resource backfill migration", () => {
  const ns = `scim-backfill-${nanoid(8)}`;
  const ACME = `org-acme-${ns}`;
  const GLOBEX = `org-globex-${ns}`;
  const DISABLED = `user-disabled-${ns}`;
  const SHARED = `user-shared-${ns}`;
  const DISABLED_AT = new Date("2026-01-02T03:04:05.000Z");

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: DISABLED,
          name: "Gone Person",
          email: `Gone.Person@${ns}.test`,
          deactivatedAt: DISABLED_AT,
        },
        { id: SHARED, name: "Shared Person", email: `shared@${ns}.test` },
      ],
    });
    await prisma.scimDirectoryUser.createMany({
      data: [
        { organizationId: ACME, connectionId: `conn-acme-${ns}`, userId: DISABLED },
        { organizationId: ACME, connectionId: `conn-acme-${ns}`, userId: SHARED },
        { organizationId: GLOBEX, connectionId: `conn-globex-${ns}`, userId: SHARED },
      ],
    });
    // The same pair claimed again through an identifier row: still one resource.
    await prisma.scimExternalId.create({
      data: {
        organizationId: ACME,
        connectionId: `conn-acme-${ns}`,
        externalId: `okta-${ns}`,
        userId: SHARED,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.scimUserResource.deleteMany({ where: { organizationId: { in: [ACME, GLOBEX] } } });
    await prisma.scimExternalId.deleteMany({ where: { organizationId: { in: [ACME, GLOBEX] } } });
    await prisma.scimDirectoryUser.deleteMany({
      where: { organizationId: { in: [ACME, GLOBEX] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [DISABLED, SHARED] } } });
  });

  /** @scenario Existing directory ownership backfills tenant resources without reactivating shared accounts */
  it("gives every distinct organization and user pair one resource and leaves the accounts as they were", async () => {
    const before = await prisma.user.findMany({
      where: { id: { in: [DISABLED, SHARED] } },
      orderBy: { id: "asc" },
    });

    await prisma.$executeRawUnsafe(backfillScopedTo({ organizationIds: [ACME, GLOBEX] }));

    const resources = await prisma.scimUserResource.findMany({
      where: { organizationId: { in: [ACME, GLOBEX] } },
      orderBy: [{ organizationId: "asc" }, { userId: "asc" }],
    });
    expect(resources.map((row) => [row.organizationId, row.userId, row.active])).toEqual([
      [ACME, DISABLED, false],
      [ACME, SHARED, true],
      [GLOBEX, SHARED, true],
    ]);
    const disabled = resources.find((row) => row.userId === DISABLED);
    expect(disabled?.userName).toBe(`gone.person@${ns}.test`.toLowerCase());

    const after = await prisma.user.findMany({
      where: { id: { in: [DISABLED, SHARED] } },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
    expect(after.find((user) => user.id === DISABLED)?.deactivatedAt).toEqual(DISABLED_AT);
    expect(after.map((user) => user.email)).toEqual(before.map((user) => user.email));
  });
});
