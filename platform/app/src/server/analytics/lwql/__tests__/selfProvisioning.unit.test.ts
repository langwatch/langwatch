/**
 * `selfProvisioning.ts` is pure over its inputs — env derivation over an
 * explicit `env` argument, statement composition with no I/O — so the
 * self-hosted deployment contract (issue #6635) is unit-testable end to end.
 * What this file pins:
 *
 * 1. Derivation fails *closed*: every incomplete or contradictory
 *    configuration returns `null` (queries refused), never a guessed
 *    connection — and a `LWQL_DATABASE` naming a database other than the
 *    admin URL's own is contradictory, because the key-map row policies and
 *    the key-map backfill would target different tables.
 * 2. The derived connection never carries the admin credentials: the URL is
 *    stripped to its origin, and the identity is the SaaS-convention
 *    restricted user.
 * 3. The ClickHouse composition keeps the harness-proven order: the
 *    restricted user is created before every grant and row policy that names
 *    it (`CREATE USER OR REPLACE` mints a new access-entity id), the named
 *    collection before the engine tables that reference it, and the engine
 *    tables are dropped first so a changed catalog converges on upgrade.
 *
 * @see ../selfProvisioning.ts — the module under test
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import { lwqlPostgresViews } from "../catalog/types";
import { productionLangWatchQLNames } from "../productionProvisioning";
import { qualified } from "../provisioning";
import {
  LWQL_SELF_PROVISION_DEFAULTS,
  lwqlDerivedConnectionFromEnv,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
  selfHostedClickHouseProvisioningStatements,
  selfHostedPostgresReaderStatements,
} from "../selfProvisioning";

const ENABLED_ENV: NodeJS.ProcessEnv = {
  LWQL_SELF_PROVISION: "true",
  LWQL_CLICKHOUSE_PASSWORD: "restricted-secret",
  LWQL_POSTGRES_READER_PASSWORD: "reader-secret",
  CLICKHOUSE_URL: "http://default:admin-secret@ch.internal:8123/langwatch",
  DATABASE_URL: "postgresql://postgres:pg-admin@pg.internal:5432/mydb",
};

describe("lwqlDerivedConnectionFromEnv", () => {
  it("returns null when self-provisioning is not enabled", () => {
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_SELF_PROVISION: undefined,
      }),
    ).toBeNull();
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_SELF_PROVISION: "1",
      }),
    ).toBeNull();
  });

  it("derives the connection from the admin URL with SaaS-convention defaults", () => {
    const connection = lwqlDerivedConnectionFromEnv(ENABLED_ENV);
    expect(connection).toEqual({
      url: "http://ch.internal:8123/",
      username: LWQL_SELF_PROVISION_DEFAULTS.restrictedUser,
      password: "restricted-secret",
      database: "langwatch",
      tenantSetting: LWQL_SELF_PROVISION_DEFAULTS.tenantSetting,
    });
  });

  it("strips the admin credentials from the derived URL", () => {
    const connection = lwqlDerivedConnectionFromEnv(ENABLED_ENV);
    expect(connection?.url).not.toContain("admin-secret");
    expect(connection?.url).not.toContain("default");
  });

  it("lets explicit LWQL_* variables override individual defaults", () => {
    const connection = lwqlDerivedConnectionFromEnv({
      ...ENABLED_ENV,
      LWQL_CLICKHOUSE_USER: "custom_user",
      LWQL_TENANT_SETTING: "custom_other_setting",
    });
    expect(connection?.username).toBe("custom_user");
    expect(connection?.tenantSetting).toBe("custom_other_setting");
  });

  it("accepts LWQL_DATABASE only when it names the admin URL's own database", () => {
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_DATABASE: "langwatch",
      })?.database,
    ).toBe("langwatch");
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_DATABASE: "elsewhere",
      }),
    ).toBeNull();
  });

  // The split-brain this guard exists to prevent: `provisionLwql` builds the
  // access model on the connection derived here, so a deployment that also set
  // `LWQL_CLICKHOUSE_URL` would provision one server and query another, and
  // every query would fail against a server holding none of the objects.
  // Refused rather than silently overridden, so the operator is told which
  // variable to drop.
  it("refuses a LWQL_CLICKHOUSE_URL pointing somewhere other than the admin URL", () => {
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_CLICKHOUSE_URL: "http://elsewhere.internal:8123/",
      }),
    ).toBeNull();
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_CLICKHOUSE_URL: "not a url",
      }),
    ).toBeNull();
  });

  // Same origin, spelled the way an operator would rather than the way the
  // derivation normalises it (admin credentials, a database path, no trailing
  // slash) — that is agreement, not a conflict, and must still resolve.
  it("accepts a LWQL_CLICKHOUSE_URL naming the admin URL's own server", () => {
    expect(
      lwqlDerivedConnectionFromEnv({
        ...ENABLED_ENV,
        LWQL_CLICKHOUSE_URL: "http://ch.internal:8123",
      })?.url,
    ).toBe("http://ch.internal:8123/");
  });

  it.each([
    ["no restricted password", { LWQL_CLICKHOUSE_PASSWORD: undefined }],
    ["no admin URL", { CLICKHOUSE_URL: undefined }],
    ["unparseable admin URL", { CLICKHOUSE_URL: "not a url" }],
    [
      "admin URL without a database path",
      { CLICKHOUSE_URL: "http://ch:8123/" },
    ],
  ] as const)("fails closed with %s", (_label, overrides) => {
    expect(
      lwqlDerivedConnectionFromEnv({ ...ENABLED_ENV, ...overrides }),
    ).toBeNull();
  });
});

describe("lwqlSelfProvisionFromEnv", () => {
  it("additionally requires the PostgreSQL reader password", () => {
    expect(
      lwqlSelfProvisionFromEnv({
        ...ENABLED_ENV,
        LWQL_POSTGRES_READER_PASSWORD: undefined,
      }),
    ).toBeNull();
    const selfProvision = lwqlSelfProvisionFromEnv(ENABLED_ENV);
    expect(selfProvision?.postgresReaderPassword).toBe("reader-secret");
    expect(selfProvision?.connection.database).toBe("langwatch");
  });
});

describe("lwqlPostgresEndpointFromDatabaseUrl", () => {
  it("reads host, port and database from the URL", () => {
    expect(
      lwqlPostgresEndpointFromDatabaseUrl(
        "postgresql://user:pw@pg.internal:5433/mydb?schema=custom",
      ),
    ).toEqual({ host: "pg.internal", port: 5433, database: "mydb" });
  });

  it("defaults the port to 5432", () => {
    expect(
      lwqlPostgresEndpointFromDatabaseUrl("postgresql://u:p@pg.internal/mydb")
        ?.port,
    ).toBe(5432);
  });

  it.each([
    undefined,
    "not a url",
    "postgresql://host-only:5432/",
  ])("returns null for %s", (url) => {
    expect(lwqlPostgresEndpointFromDatabaseUrl(url)).toBeNull();
  });
});

const NAMES = productionLangWatchQLNames({
  connection: {
    url: "http://ch.internal:8123/",
    username: LWQL_SELF_PROVISION_DEFAULTS.restrictedUser,
    password: "restricted-secret",
    database: "langwatch",
    tenantSetting: LWQL_SELF_PROVISION_DEFAULTS.tenantSetting,
  },
});

function selfHostedStatements(): string[] {
  return selfHostedClickHouseProvisioningStatements({
    names: NAMES,
    restrictedPassword: "restricted-secret",
    sourceDatabase: "langwatch",
    postgres: {
      endpoint: { host: "pg.internal", port: 5432, database: "mydb" },
      readerPassword: "reader-secret",
    },
  });
}

describe("selfHostedClickHouseProvisioningStatements", () => {
  it("refuses a LangWatchQL database other than the application's own", () => {
    expect(() =>
      selfHostedClickHouseProvisioningStatements({
        names: { ...NAMES, database: "elsewhere" },
        restrictedPassword: "restricted-secret",
        sourceDatabase: "langwatch",
        postgres: {
          endpoint: { host: "pg.internal", port: 5432, database: "mydb" },
          readerPassword: "reader-secret",
        },
      }),
    ).toThrow(/must be the application's own ClickHouse database/);
  });

  it("creates the restricted user before every grant and row policy naming it", () => {
    const statements = selfHostedStatements();
    const userIndex = statements.findIndex((statement) =>
      statement.startsWith("CREATE USER OR REPLACE"),
    );
    expect(userIndex).toBeGreaterThanOrEqual(0);
    for (const [index, statement] of statements.entries()) {
      if (
        statement.startsWith("GRANT") ||
        statement.startsWith("CREATE ROW POLICY")
      ) {
        expect(index).toBeGreaterThan(userIndex);
      }
    }
  });

  // The tenant boundary, pinned as an ordering property rather than a
  // presence one. A table carrying a SELECT grant and no row policy returns
  // every row, and provisioning is not atomic, so grants-first would leave a
  // partial run readable across tenants — the one failure mode the design
  // rules out. Policies-first makes the same partial run refuse instead.
  it("creates every row policy before any grant, so a partial run refuses rather than leaks", () => {
    const statements = selfHostedStatements();
    const lastPolicyIndex = statements.reduce(
      (last, statement, index) =>
        statement.startsWith("CREATE ROW POLICY") ? index : last,
      -1,
    );
    const firstGrantIndex = statements.findIndex((statement) =>
      statement.startsWith("GRANT"),
    );

    expect(lastPolicyIndex).toBeGreaterThanOrEqual(0);
    expect(firstGrantIndex).toBeGreaterThanOrEqual(0);
    expect(lastPolicyIndex).toBeLessThan(firstGrantIndex);
  });

  it("creates the named collection before the engine tables referencing it, dropping stale tables first", () => {
    const statements = selfHostedStatements();
    const collectionIndex = statements.findIndex((statement) =>
      statement.startsWith("CREATE NAMED COLLECTION"),
    );
    expect(collectionIndex).toBeGreaterThanOrEqual(0);
    for (const view of lwqlPostgresViews(LWQL_VIEW_CATALOG)) {
      const dropIndex = statements.findIndex((statement) =>
        statement.startsWith(
          `DROP TABLE IF EXISTS langwatch.${view.sourceTable}`,
        ),
      );
      const createIndex = statements.findIndex(
        (statement) =>
          statement.startsWith(
            `CREATE TABLE IF NOT EXISTS langwatch.${view.sourceTable}`,
          ) && statement.includes("ENGINE = PostgreSQL"),
      );
      expect(dropIndex).toBeGreaterThan(collectionIndex);
      expect(createIndex).toBeGreaterThan(dropIndex);
    }
  });

  it("dials PostgreSQL as the reader role, never the application's admin", () => {
    const collection = selfHostedStatements().find((statement) =>
      statement.startsWith("CREATE NAMED COLLECTION"),
    );
    expect(collection).toContain(
      `user='${LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole}'`,
    );
    expect(collection).toContain("password='reader-secret'");
  });

  // Per catalog entry, not a count: a `toBeGreaterThan(0)` over the whole set
  // stays green when a single view or its grant goes missing, which is the
  // one failure this test exists to catch. `it.each` so the report names the
  // view that regressed rather than "provisions every catalog view".
  it.each(
    LWQL_VIEW_CATALOG.map((view) => [view.name, view] as const),
  )("provisions the %s view with its own grant", (_name, view) => {
    const statements = selfHostedStatements();
    const target = qualified(NAMES, view.name);

    expect(
      statements.filter(
        (statement) =>
          statement.startsWith("CREATE OR REPLACE VIEW") &&
          statement.includes(target),
      ),
    ).toHaveLength(1);
    expect(statements).toContain(
      `GRANT SELECT ON ${target} TO ${NAMES.restrictedUser}`,
    );
  });
});

describe("selfHostedPostgresReaderStatements", () => {
  it("converges the lwql_ro role with a catalog-derived connection limit and grants on every approved view", () => {
    const statements = selfHostedPostgresReaderStatements({
      schema: "public",
      readerPassword: "reader-secret",
    });
    const alter = statements.find((statement) =>
      statement.startsWith('ALTER ROLE "lwql_ro" WITH LOGIN PASSWORD'),
    );
    expect(alter).toBeDefined();
    expect(alter).toMatch(/CONNECTION LIMIT \d+/);
    const grants = statements.filter((statement) =>
      statement.startsWith("GRANT SELECT ON"),
    );
    expect(grants.length).toBe(lwqlPostgresViews(LWQL_VIEW_CATALOG).length);
  });
});
