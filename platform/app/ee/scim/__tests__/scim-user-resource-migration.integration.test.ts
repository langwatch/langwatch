import { readFileSync } from "node:fs";

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { generate } from "@langwatch/ksuid";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";

import { env } from "~/env.mjs";

const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/20260918171008_scim_user_resources/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const tables = `
  CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "email" TEXT, "name" TEXT, "deactivatedAt" TIMESTAMP, "createdAt" TIMESTAMP, "updatedAt" TIMESTAMP);
  CREATE TABLE "ScimDirectoryUser" ("organizationId" TEXT, "userId" TEXT);
  CREATE TABLE "ScimExternalId" ("organizationId" TEXT, "userId" TEXT);
`;

const onScratchSchema = async (
  body: ({ client }: { client: PoolClient }) => Promise<void>,
) => {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schema = `scim_migration_${generate("migration")
      .toString()
      .replace(/[^a-zA-Z0-9]/g, "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(tables);
    await body({ client });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
};

/** @scenario "Existing directory ownership backfills tenant resources without reactivating shared accounts" */
it("backfills distinct tenant resources and preserves historical account disables", async () => {
  await onScratchSchema(async ({ client }) => {
    await client.query(`
      INSERT INTO "User" VALUES
        ('active', 'Person@Example.test', 'Active', NULL, '2026-01-01', '2026-01-02'),
        ('disabled', 'Disabled@Example.test', 'Disabled', '2026-02-01', '2026-01-01', '2026-01-02');
      INSERT INTO "ScimDirectoryUser" VALUES ('a', 'active'), ('a', 'disabled'), ('b', 'active');
      INSERT INTO "ScimExternalId" VALUES ('a', 'active');
    `);
    await client.query(migration);
    const resources = await client.query(
      'SELECT "organizationId", "userId", "userName", "active" FROM "ScimUserResource" ORDER BY "organizationId", "userId"',
    );
    expect(resources.rows).toEqual([
      {
        organizationId: "a",
        userId: "active",
        userName: "person@example.test",
        active: true,
      },
      {
        organizationId: "a",
        userId: "disabled",
        userName: "disabled@example.test",
        active: false,
      },
      {
        organizationId: "b",
        userId: "active",
        userName: "person@example.test",
        active: true,
      },
    ]);
    await client.query(
      `INSERT INTO "ScimUserResource" ("organizationId", "userId", "userName") VALUES ('a', 'blank-one', ''), ('a', 'blank-two', '   ')`,
    );
    const blanks = await client.query(
      `SELECT count(*)::int AS count FROM "ScimUserResource" WHERE btrim("userName") = ''`,
    );
    expect(blanks.rows).toEqual([{ count: 2 }]);
    const sharedAccount = await client.query(
      'SELECT "email", "deactivatedAt" IS NOT NULL AS disabled FROM "User" WHERE "id" = $1',
      ["disabled"],
    );
    expect(sharedAccount.rows).toEqual([
      { email: "Disabled@Example.test", disabled: true },
    ]);
  });
});

it("refuses to fold two accounts one tenant claims whose emails differ only in case, naming the alias", async () => {
  await onScratchSchema(async ({ client }) => {
    await client.query(`
      INSERT INTO "User" VALUES
        ('lower', 'person@example.test', 'Lower', NULL, '2026-01-01', '2026-01-02'),
        ('upper', 'Person@Example.test', 'Upper', NULL, '2026-01-01', '2026-01-02');
      INSERT INTO "ScimDirectoryUser" VALUES ('a', 'lower'), ('a', 'upper');
    `);
    await expect(client.query(migration)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("First 20: a / person@example.test"),
    });
  });
});

it("lets one account carry the same alias in two tenants", async () => {
  await onScratchSchema(async ({ client }) => {
    await client.query(`
      INSERT INTO "User" VALUES ('shared', 'Person@Example.test', 'Shared', NULL, '2026-01-01', '2026-01-02');
      INSERT INTO "ScimDirectoryUser" VALUES ('a', 'shared'), ('b', 'shared');
    `);
    await client.query(migration);
    const resources = await client.query(
      'SELECT "organizationId" FROM "ScimUserResource" ORDER BY "organizationId"',
    );
    expect(resources.rows).toEqual([
      { organizationId: "a" },
      { organizationId: "b" },
    ]);
  });
});
