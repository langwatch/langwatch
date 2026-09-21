import { readFileSync } from "node:fs";

import { generate } from "@langwatch/ksuid";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const client = new Client({ connectionString: process.env.DATABASE_URL });
const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/20260918171006_sso_scim_ownership_backfill/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
beforeAll(async () => {
  await client.connect();
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  const schema = `migration_${generate("migration")
    .toString()
    .replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(`
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
  `);
});
afterEach(async () => {
  await client.query("ROLLBACK");
});

describe("SSO and SCIM ownership upgrade", () => {
  /** @scenario "An upgrade restores verified domain routes and tenant-owned directory identities" */
  it("backfills tenants and holders, preserving existing owners and excluding retired connections", async () => {
    await client.query(
      `INSERT INTO "SsoVerifiedDomain" VALUES ('acme.test', 'acme'); INSERT INTO "SsoVerifiedDomainHolder" VALUES ('acme.test', 'active', 'acme');`,
    );
    await client.query(migration);
    expect(
      (await client.query('SELECT * FROM "SsoVerifiedDomain"')).rows,
    ).toEqual([{ domain: "acme.test", organizationId: "acme" }]);
    expect(
      (
        await client.query(
          'SELECT "connectionId" FROM "SsoVerifiedDomainHolder" ORDER BY "connectionId"',
        )
      ).rows,
    ).toEqual([{ connectionId: "active" }, { connectionId: "replacement" }]);
    expect(
      (await client.query('SELECT "organizationId" FROM "ScimDirectoryUser"'))
        .rows,
    ).toEqual([{ organizationId: "acme" }]);
    expect(
      (await client.query('SELECT "organizationId" FROM "ScimExternalId"'))
        .rows,
    ).toEqual([{ organizationId: "acme" }]);
  });

  it("creates a missing verified-domain owner", async () => {
    await client.query(migration);
    expect(
      (await client.query('SELECT * FROM "SsoVerifiedDomain"')).rows,
    ).toEqual([{ domain: "acme.test", organizationId: "acme" }]);
  });

  it("refuses cross-tenant domain collisions", async () => {
    await client.query(
      `INSERT INTO "SsoConnection" VALUES ('foreign', 'globex', 'ACTIVE', ARRAY['acme.test'])`,
    );
    await expect(client.query(migration)).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("refuses to guess the tenant of an orphaned directory identity, naming its connection", async () => {
    await client.query(
      `INSERT INTO "ScimExternalId" VALUES ('missing', 'orphan', 'person')`,
    );
    await expect(client.query(migration)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("First 20: missing"),
    });
  });
});
