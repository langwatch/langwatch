/**
 * `productionProvisioning.ts` is pure composition — no I/O, so every branch is
 * unit-testable without a database. Two things this file exists to pin:
 *
 * 1. This deploy provisions ClickHouse-native views only — never the access
 *    model (grants, row policies, the restricted user) and never the
 *    PostgreSQL-mapped views. Both are infra's job (terraform), and a
 *    regression here would ship a `GRANT`/`CREATE USER` against infra's
 *    XML-managed identity.
 * 2. `lwqlKeyMapTableQualifiedName` always resolves the key-map table under
 *    `sourceDatabase` (migration 00084's database), never `names.database`.
 *    A backfill using the wrong database writes rows a query never sees.
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
import {
  isCurrentGenerationCapability,
  LWQL_KEY_MAP_TABLE,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
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
// point of `lwqlKeyMapTableQualifiedName`'s regression test is that it must
// NOT resolve to `names.database`, so the fixture has to make those two
// values disagree or the assertion would pass vacuously.
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
  it("qualifies against sourceDatabase, not names.database", () => {
    const result = lwqlKeyMapTableQualifiedName({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
    });

    expect(result).toBe(`${SOURCE_DATABASE}.${LWQL_KEY_MAP_TABLE}`);
    expect(result).not.toBe(`${NAMES.database}.${LWQL_KEY_MAP_TABLE}`);
  });
});

describe("given productionClickHouseObjectStatements", () => {
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
  ])("never emits a statement containing %s — this deploy does not provision %s (infra's job)", (needle) => {
    expect(statements.some((s) => s.includes(needle))).toBe(false);
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

  it("creates the view in the given schema, not a hardcoded public", () => {
    const statements = productionPostgresApprovedViewStatements({
      schema: "langwatch_db",
      views: [POSTGRES_RESIDENT_VIEW],
    });

    expect(statements[0]).toContain('"langwatch_db".');
    expect(statements[0]).not.toContain('"public".');
  });
});

describe("given lwqlPostgresSchemaFromDatabaseUrl", () => {
  it("reads Prisma's schema query parameter", () => {
    expect(
      lwqlPostgresSchemaFromDatabaseUrl(
        "postgresql://user:pass@db.internal:5432/langwatch_db?sslmode=no-verify&schema=langwatch_db",
      ),
    ).toBe("langwatch_db");
  });

  it("defaults to public when the URL names no schema", () => {
    expect(
      lwqlPostgresSchemaFromDatabaseUrl(
        "postgresql://user:pass@db.internal:5432/mydb",
      ),
    ).toBe("public");
  });

  it("defaults to public when no URL is set at all", () => {
    expect(lwqlPostgresSchemaFromDatabaseUrl(undefined)).toBe("public");
  });

  it("treats a bare ?schema= as no schema named, like prismaPgAdapter does", () => {
    expect(
      lwqlPostgresSchemaFromDatabaseUrl(
        "postgresql://user:pass@db.internal:5432/mydb?schema=",
      ),
    ).toBe("public");
  });

  it("throws on a present-but-unparseable URL instead of silently provisioning into public", () => {
    expect(() => lwqlPostgresSchemaFromDatabaseUrl("not a url")).toThrow(
      /not a parseable URL/,
    );
  });
});

describe("given planLwqlKeyMapBackfill", () => {
  describe("when a project has a blank lwqlKey", () => {
    it("surfaces it in blankKeyProjectIds instead of inserting a row", async () => {
      const plan = await planLwqlKeyMapBackfill({
        projects: [{ id: "project-blank", lwqlKey: "" }],
        existingHashes: new Set(),
      });

      expect(plan.blankKeyProjectIds).toEqual(["project-blank"]);
      expect(plan.rowsToInsert).toEqual([]);
    });

    it("does not reject, even though lwqlTenantCapability rejects on an empty secret", async () => {
      await expect(
        planLwqlKeyMapBackfill({
          projects: [{ id: "project-blank", lwqlKey: "" }],
          existingHashes: new Set(),
        }),
      ).resolves.toEqual({
        rowsToInsert: [],
        blankKeyProjectIds: ["project-blank"],
        unhashableProjectIds: [],
      });
    });
  });

  /**
   * The capability's second refusal, and the one that arrived with bcrypt: a
   * key past 72 bytes cannot be hashed without silently truncating it. The
   * contract is the same as for a blank key — collect the project, keep going —
   * and the reason is the blast radius. Propagating the rejection would fail
   * the whole deploy-time backfill, insert nothing for anyone, and never name
   * the project at fault.
   */
  /**
   * The backfill runs on every pod's boot path, before the listener starts and
   * inside the startup probe's budget, so what it does on the *second* deploy
   * matters more than what it does on the first. Deriving a capability costs
   * roughly 200ms; doing it for every project on every deploy is a KDF per
   * project of boot latency forever, and at enough projects it outruns the
   * probe and the pod never converges.
   */
  describe("when a project already holds a current-generation row", () => {
    /** @scenario "A deploy re-derives only the projects whose key-map row is out of date" */
    it("derives nothing for it, so a steady-state deploy does no bcrypt work", async () => {
      const plan = await planLwqlKeyMapBackfill({
        projects: [{ id: "project-mapped", lwqlKey: "a-perfectly-normal-key" }],
        existingHashes: new Set(),
        tenantsHoldingCurrentCapability: new Set(["project-mapped"]),
      });

      expect(plan.rowsToInsert).toEqual([]);
      expect(plan.blankKeyProjectIds).toEqual([]);
      expect(plan.unhashableProjectIds).toEqual([]);
    });

    /**
     * The skip keys on the *current* generation, not on "has any row at all".
     * Every project holds a previous-generation row on the deploy that changes
     * the derivation, and skipping those would leave the key map permanently
     * stale — the migration would silently never happen.
     */
    /** @scenario "A deploy re-derives only the projects whose key-map row is out of date" */
    it("still derives for a project whose only row is a previous generation", async () => {
      const plan = await planLwqlKeyMapBackfill({
        projects: [{ id: "project-stale", lwqlKey: "a-perfectly-normal-key" }],
        existingHashes: new Set(["a".repeat(64)]),
        tenantsHoldingCurrentCapability: new Set(),
      });

      expect(plan.rowsToInsert).toEqual([
        {
          KeyHash: expect.stringMatching(/^\$2b\$10\$/),
          TenantId: "project-stale",
        },
      ]);
    });
  });

  /**
   * The prefix test is what separates those two cases, and it reads the cost
   * factor out of the stored value — so it has to move if the cost ever does.
   */
  describe("when a stored hash is checked for its generation", () => {
    it("accepts this derivation's digests and rejects a bare sha256 hex", async () => {
      const current = await lwqlTenantCapability({
        secret: "generation-check",
      });

      expect(isCurrentGenerationCapability(current)).toBe(true);
      expect(isCurrentGenerationCapability("a".repeat(64))).toBe(false);
      // A different cost factor is a different generation, not a variant.
      expect(isCurrentGenerationCapability(`$2b$12$${"a".repeat(53)}`)).toBe(
        false,
      );
    });
  });

  describe("when a project's lwqlKey is longer than bcrypt reads", () => {
    /** @scenario "One project's unusable secret never costs the other projects their key-map rows" */
    it("reports that project and still plans rows for the others", async () => {
      const plan = await planLwqlKeyMapBackfill({
        projects: [
          { id: "project-overlong", lwqlKey: "x".repeat(73) },
          { id: "project-healthy", lwqlKey: "a-perfectly-normal-key" },
        ],
        existingHashes: new Set(),
      });

      expect(plan.unhashableProjectIds).toEqual(["project-overlong"]);
      expect(plan.rowsToInsert).toEqual([
        {
          KeyHash: expect.stringMatching(/^\$2b\$10\$/),
          TenantId: "project-healthy",
        },
      ]);
    });
  });

  describe("when a project's key hash is already in existingHashes", () => {
    it("excludes it from rowsToInsert", async () => {
      const hash = await lwqlTenantCapability({ secret: "already-mapped-key" });
      const plan = await planLwqlKeyMapBackfill({
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
    it("inserts only the first occurrence", async () => {
      const plan = await planLwqlKeyMapBackfill({
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
    it("includes it in rowsToInsert with its real hash", async () => {
      const plan = await planLwqlKeyMapBackfill({
        projects: [{ id: "project-new", lwqlKey: "brand-new-key" }],
        existingHashes: new Set(),
      });

      expect(plan.rowsToInsert).toEqual([
        {
          KeyHash: await lwqlTenantCapability({ secret: "brand-new-key" }),
          TenantId: "project-new",
        },
      ]);
      expect(plan.blankKeyProjectIds).toEqual([]);
    });
  });

  describe("when projects mix blank, already-mapped, and new keys", () => {
    it("handles each independently in a single pass", async () => {
      const existingHash = await lwqlTenantCapability({
        secret: "existing-key",
      });
      const plan = await planLwqlKeyMapBackfill({
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
          KeyHash: await lwqlTenantCapability({ secret: "new-key" }),
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
