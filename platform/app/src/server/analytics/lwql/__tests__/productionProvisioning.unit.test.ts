/**
 * `productionProvisioning.ts` is pure composition — no I/O, so every branch is
 * unit-testable without a database. Two things this file exists to pin:
 *
 * 1. The DEFAULT (SaaS) / FULL (self-hosted) mode split: DEFAULT provisions
 *    ClickHouse-native views only; FULL additionally provisions the whole
 *    access model and the PostgreSQL-mapped views. A regression here either
 *    ships grants/policies against infra's XML-managed identity (DEFAULT) or
 *    silently drops the access model a self-hosted deploy needs (FULL).
 * 2. `lwqlKeyMapTableQualifiedName`'s database split: DEFAULT mode's key-map
 *    table is migration 00084's, under the app's own ClickHouse database
 *    (`sourceDatabase`) — not `names.database`. FULL mode's is its own copy,
 *    always under `names.database`. A backfill using the wrong database in
 *    either mode writes rows a query never sees.
 *
 * @see ../productionProvisioning.ts — the composition under test
 * @see ../../clickhouse/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";
import { lwqlTenantCapability } from "../capability";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "../catalog/types";
import { lwqlPostgresViews } from "../catalog/types";
import type { LangWatchQLConnection } from "../executor";
import type { PostgresNamedCollection } from "../postgresMapping";
import {
  LWQL_KEY_MAP_TABLE,
  LWQL_POSTGRES_READER_ROLE,
  lwqlKeyMapTableQualifiedName,
  parseAppPostgresConnection,
  planLwqlKeyMapBackfill,
  productionClickHouseAccessModelStatements,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  productionPostgresReaderRoleStatements,
  withTenancyOptOut,
} from "../productionProvisioning";
import type { LangWatchQLNames } from "../provisioning";
import { GATED_DATASET } from "./gatedDatasetFixture";

const CONNECTION: LangWatchQLConnection = {
  url: "https://ch.internal.example.com:8443",
  username: "langwatch_lwql",
  password: "super-secret-password",
  database: "lwql_prod",
  tenantSetting: "custom_api_key_hash",
};

const NAMES: LangWatchQLNames = productionLangWatchQLNames({
  connection: CONNECTION,
});

// Deliberately different from `NAMES.database` ("lwql_prod") — the whole
// point of `lwqlKeyMapTableQualifiedName`'s regression test is that DEFAULT
// mode must NOT resolve to `names.database`, so the fixture has to make those
// two values disagree or the assertion would pass vacuously.
const SOURCE_DATABASE = "langwatch_analytics";

/**
 * One real PostgreSQL-resident view from the shipped catalog, rather than a
 * hand-rolled fixture — guarantees every field `postgres`-mapping code reads
 * is actually populated, and the `if (!view) throw` keeps this loud (not a
 * silently-skipped test) if the catalog ever ships with none.
 */
function firstPostgresResidentView() {
  const [view] = lwqlPostgresViews(LWQL_VIEW_CATALOG);
  if (!view) {
    throw new Error(
      "test fixture: LWQL_VIEW_CATALOG has no PostgreSQL-resident view — productionProvisioning tests need at least one to exercise the mapped-view code paths",
    );
  }
  return view;
}

const POSTGRES_RESIDENT_VIEW = firstPostgresResidentView();

const MIXED_VIEWS: readonly LangWatchQLViewDefinition[] = [
  GATED_DATASET,
  POSTGRES_RESIDENT_VIEW,
];

describe("given productionLangWatchQLNames", () => {
  it("derives every name from the connection", () => {
    expect(productionLangWatchQLNames({ connection: CONNECTION })).toEqual({
      database: CONNECTION.database,
      restrictedUser: CONNECTION.username,
      settingsProfile: `${CONNECTION.database}_profile`,
      keyMapTable: LWQL_KEY_MAP_TABLE,
      tenantSetting: CONNECTION.tenantSetting,
    });
  });
});

describe("given lwqlKeyMapTableQualifiedName", () => {
  describe("when in DEFAULT (SaaS) mode", () => {
    it("qualifies against sourceDatabase, not names.database", () => {
      const result = lwqlKeyMapTableQualifiedName({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        isFullMode: false,
      });

      expect(result).toBe(`${SOURCE_DATABASE}.${LWQL_KEY_MAP_TABLE}`);
      expect(result).not.toBe(`${NAMES.database}.${LWQL_KEY_MAP_TABLE}`);
    });
  });

  describe("when in FULL (self-hosted) mode", () => {
    it("qualifies against names.database, ignoring sourceDatabase", () => {
      const result = lwqlKeyMapTableQualifiedName({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        isFullMode: true,
      });

      expect(result).toBe(`${NAMES.database}.${LWQL_KEY_MAP_TABLE}`);
      expect(result).not.toBe(`${SOURCE_DATABASE}.${LWQL_KEY_MAP_TABLE}`);
    });
  });
});

describe("given productionClickHouseObjectStatements (DEFAULT mode)", () => {
  const statements = productionClickHouseObjectStatements({
    names: NAMES,
    sourceDatabase: SOURCE_DATABASE,
    views: MIXED_VIEWS,
  });

  it("creates the LangWatchQL database first", () => {
    expect(statements[0]).toBe(
      `CREATE DATABASE IF NOT EXISTS ${NAMES.database}`,
    );
  });

  it("creates a view for the ClickHouse-native dataset", () => {
    expect(
      statements.some((s) =>
        s.includes(`${NAMES.database}.${GATED_DATASET.name}`),
      ),
    ).toBe(true);
  });

  it("does not create a view for the PostgreSQL-resident dataset", () => {
    expect(
      statements.some((s) =>
        s.includes(`${NAMES.database}.${POSTGRES_RESIDENT_VIEW.name}`),
      ),
    ).toBe(false);
  });

  it.each([
    ["GRANT", "grants"],
    ["CREATE ROW POLICY", "row policies"],
    ["CREATE USER", "a restricted user"],
    [
      LWQL_KEY_MAP_TABLE,
      "the key-map table (migration 00084 already created it)",
    ],
  ])("never emits a statement containing %s — DEFAULT mode does not provision %s", (needle) => {
    expect(statements.some((s) => s.includes(needle))).toBe(false);
  });
});

describe("given productionClickHouseAccessModelStatements (FULL mode)", () => {
  const postgresConnection: PostgresNamedCollection = {
    collection: `lwql_${NAMES.database}_postgres`,
    host: "postgres.internal.example.com",
    port: 5432,
    database: "langwatch",
    user: LWQL_POSTGRES_READER_ROLE,
    password: "reader-password",
  };

  const statements = productionClickHouseAccessModelStatements({
    names: NAMES,
    sourceDatabase: SOURCE_DATABASE,
    restrictedUserPassword: "restricted-password",
    postgresConnection,
    views: MIXED_VIEWS,
  });

  it("creates the LangWatchQL database exactly once", () => {
    // Regression: an earlier draft emitted this twice — once directly, once
    // via lwqlClickHouseSetupStatements (which already includes it).
    const createDatabaseStatements = statements.filter(
      (s) => s === `CREATE DATABASE IF NOT EXISTS ${NAMES.database}`,
    );
    expect(createDatabaseStatements).toHaveLength(1);
  });

  it("creates the key-map table under names.database", () => {
    expect(
      statements.some((s) =>
        s.includes(`${NAMES.database}.${LWQL_KEY_MAP_TABLE}`),
      ),
    ).toBe(true);
  });

  it("creates the restricted user", () => {
    expect(statements.some((s) => s.includes("CREATE USER"))).toBe(true);
  });

  it("creates row policies", () => {
    expect(statements.some((s) => s.includes("CREATE ROW POLICY"))).toBe(true);
  });

  it("creates the named collection for the PostgreSQL bridge", () => {
    expect(
      statements.some((s) => s.includes(postgresConnection.collection)),
    ).toBe(true);
  });

  it("creates a view for the ClickHouse-native dataset", () => {
    expect(
      statements.some((s) =>
        s.includes(`${NAMES.database}.${GATED_DATASET.name}`),
      ),
    ).toBe(true);
  });

  it("creates a view for the PostgreSQL-mapped dataset", () => {
    expect(
      statements.some((s) =>
        s.includes(`${NAMES.database}.${POSTGRES_RESIDENT_VIEW.name}`),
      ),
    ).toBe(true);
  });
});

describe("given productionPostgresApprovedViewStatements", () => {
  it("creates a statement for a PostgreSQL-resident dataset", () => {
    const statements = productionPostgresApprovedViewStatements({
      views: [POSTGRES_RESIDENT_VIEW],
    });

    expect(statements.length).toBeGreaterThan(0);
    expect(
      statements.some((s) =>
        s.includes(POSTGRES_RESIDENT_VIEW.postgres.approvedView),
      ),
    ).toBe(true);
  });

  it("returns nothing for a views array with no PostgreSQL-resident dataset", () => {
    expect(
      productionPostgresApprovedViewStatements({ views: [GATED_DATASET] }),
    ).toEqual([]);
  });
});

describe("given productionPostgresReaderRoleStatements", () => {
  it("provisions the dedicated reader role", () => {
    const statements = productionPostgresReaderRoleStatements({
      password: "reader-password",
      views: [POSTGRES_RESIDENT_VIEW],
    });

    expect(statements.some((s) => s.includes(LWQL_POSTGRES_READER_ROLE))).toBe(
      true,
    );
  });

  it("throws for a views array with no PostgreSQL-resident dataset", () => {
    // A role with nothing to read is a self-hosted deploy provisioning a dead
    // end — the underlying guard (postgresMapping.ts) rejects it, and this
    // pins that this module's composition doesn't swallow that rejection.
    expect(() =>
      productionPostgresReaderRoleStatements({
        password: "reader-password",
        views: [GATED_DATASET],
      }),
    ).toThrow(/at least one approved view/);
  });
});

describe("given parseAppPostgresConnection", () => {
  describe("when databaseUrl is a valid PostgreSQL connection string", () => {
    it("parses host, port, and database", () => {
      expect(
        parseAppPostgresConnection({
          databaseUrl:
            "postgresql://user:pass@db.internal.example.com:5433/langwatch",
        }),
      ).toEqual({
        host: "db.internal.example.com",
        port: 5433,
        database: "langwatch",
      });
    });
  });

  describe("when the URL has no explicit port", () => {
    it("defaults to 5432", () => {
      const result = parseAppPostgresConnection({
        databaseUrl: "postgresql://user:pass@db.internal.example.com/langwatch",
      });
      expect(result.port).toBe(5432);
    });
  });

  describe("when databaseUrl is empty", () => {
    // Passed explicitly as "" rather than omitted: omitting it falls through
    // to the real process.env.DATABASE_URL default, which would make this
    // test's outcome depend on whatever the test process's environment
    // happens to have set.
    it("throws rather than silently mapping nothing", () => {
      expect(() => parseAppPostgresConnection({ databaseUrl: "" })).toThrow(
        /DATABASE_URL is not set/,
      );
    });
  });

  describe("when databaseUrl is not a valid URL", () => {
    it("throws", () => {
      expect(() =>
        parseAppPostgresConnection({ databaseUrl: "not-a-url" }),
      ).toThrow(/not a valid connection URL/);
    });
  });

  describe("when databaseUrl has no database name in its path", () => {
    it("throws", () => {
      expect(() =>
        parseAppPostgresConnection({
          databaseUrl: "postgresql://user:pass@db.internal.example.com:5432/",
        }),
      ).toThrow(/no database name/);
    });
  });
});

describe("given planLwqlKeyMapBackfill", () => {
  describe("when a project has a blank lwqlKey", () => {
    it("surfaces it in blankKeyProjectIds instead of inserting a row", () => {
      const plan = planLwqlKeyMapBackfill({
        projects: [{ id: "project-blank", lwqlKey: "" }],
        existingHashes: new Set(),
      });

      expect(plan.blankKeyProjectIds).toEqual(["project-blank"]);
      expect(plan.rowsToInsert).toEqual([]);
    });

    it("does not throw, even though lwqlTenantCapability throws on an empty secret", () => {
      expect(() =>
        planLwqlKeyMapBackfill({
          projects: [{ id: "project-blank", lwqlKey: "" }],
          existingHashes: new Set(),
        }),
      ).not.toThrow();
    });
  });

  describe("when a project's key hash is already in existingHashes", () => {
    it("excludes it from rowsToInsert", () => {
      const hash = lwqlTenantCapability({ secret: "already-mapped-key" });
      const plan = planLwqlKeyMapBackfill({
        projects: [{ id: "project-existing", lwqlKey: "already-mapped-key" }],
        existingHashes: new Set([hash]),
      });

      expect(plan.rowsToInsert).toEqual([]);
      expect(plan.blankKeyProjectIds).toEqual([]);
    });
  });

  describe("when two projects share the same lwqlKey within one run", () => {
    // Contrived — a unique key is the invariant this table exists to record —
    // but the plan still must not depend on that invariant holding, so it
    // dedupes within a single run rather than inserting both.
    it("inserts only the first occurrence", () => {
      const plan = planLwqlKeyMapBackfill({
        projects: [
          { id: "project-a", lwqlKey: "shared-key" },
          { id: "project-b", lwqlKey: "shared-key" },
        ],
        existingHashes: new Set(),
      });

      expect(plan.rowsToInsert).toHaveLength(1);
      expect(plan.rowsToInsert[0]?.TenantId).toBe("project-a");
    });
  });

  describe("when a project has a new, non-blank, not-yet-mapped key", () => {
    it("includes it in rowsToInsert with its real hash", () => {
      const plan = planLwqlKeyMapBackfill({
        projects: [{ id: "project-new", lwqlKey: "brand-new-key" }],
        existingHashes: new Set(),
      });

      expect(plan.rowsToInsert).toEqual([
        {
          KeyHash: lwqlTenantCapability({ secret: "brand-new-key" }),
          TenantId: "project-new",
        },
      ]);
      expect(plan.blankKeyProjectIds).toEqual([]);
    });
  });

  describe("when projects mix blank, already-mapped, and new keys", () => {
    it("handles each independently in a single pass", () => {
      const existingHash = lwqlTenantCapability({ secret: "existing-key" });
      const plan = planLwqlKeyMapBackfill({
        projects: [
          { id: "project-blank", lwqlKey: "" },
          { id: "project-existing", lwqlKey: "existing-key" },
          { id: "project-new", lwqlKey: "new-key" },
        ],
        existingHashes: new Set([existingHash]),
      });

      expect(plan.blankKeyProjectIds).toEqual(["project-blank"]);
      expect(plan.rowsToInsert).toEqual([
        {
          KeyHash: lwqlTenantCapability({ secret: "new-key" }),
          TenantId: "project-new",
        },
      ]);
    });
  });
});

describe("given withTenancyOptOut", () => {
  it("prepends the tenancy opt-out comment guardProjectId expects", () => {
    const result = withTenancyOptOut("CREATE VIEW example AS SELECT 1");

    expect(result).toBe(
      "-- @tenancy: provisions LangWatchQL catalog objects shared across every tenant, not scoped to one\nCREATE VIEW example AS SELECT 1",
    );
  });
});
