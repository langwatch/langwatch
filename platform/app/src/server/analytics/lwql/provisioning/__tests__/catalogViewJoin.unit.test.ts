/**
 * The two-source view shape (#8085 / #8116 Part B, step 3): a catalog view may
 * be rendered from a primary fact table joined to a second, with both tenant-
 * policed.
 *
 * Two things are proved here without a database:
 *
 *  - **Nothing about a single-table view changed.** Every existing view still
 *    renders byte-for-byte the SQL it did before the join fields existed,
 *    asserted against `existingViewSql.snapshot.json` — a capture of the
 *    renderer's output taken before this change.
 *  - **A joined view renders the join, the pre-filter, the joined-side grant and
 *    a row policy for both tables.** The tenant enforcement over real ClickHouse
 *    is proved in `tenantIsolation.integration.test.ts`; this pins the SQL text.
 */
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { describe, expect, it } from "vitest";
import { lwqlNamesForSuite } from "../../__tests__/lwqlClickHouseHarness";
import { lwqlViewByName } from "../../catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "../../catalog/types";
import { renderLwqlAccessModelDdl } from "../accessModelDdl";
import { buildLwqlAccessModelDefinition } from "../accessModelDefinition";
import {
  LWQL_SOURCE_ALIAS,
  lwqlJoinSourceColumnGrantStatement,
  lwqlSourceColumnGrantStatement,
  lwqlSourceTables,
  lwqlViewStatement,
  SHIPPED_LWQL_DEDUP,
} from "../catalogStatements";
import type { PostgresNamedCollection } from "../postgresMapping";

/** The names the snapshot fixture was captured under. */
const NAMES = lwqlNamesForSuite("snap");
const SOURCE_DATABASE = "langwatch";

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "lwql_postgres",
  host: "pg.internal",
  port: 5432,
  database: SOURCE_DATABASE,
  user: "lwql_ro",
  password: "reader-secret",
};

/**
 * A synthetic two-table view — `join_left` ⋈ `join_right` on `Key`, with a
 * pre-filter and one column read from each side. Kept out of the shipped
 * catalog: it exercises the machinery, it is not a dataset.
 */
const JOIN_VIEW: LangWatchQLViewDefinition = {
  name: "join_probe",
  sourceTable: "join_left",
  description: "probe: a left table joined to a right table",
  gates: [],
  grain: "one left row",
  grainColumns: ["TenantId", "Key"],
  joinKeys: [],
  timeColumn: "OccurredAt",
  freshness: "test",
  dedup: { keyColumns: ["TenantId", "Key"], strategy: "none" },
  where: `${LWQL_SOURCE_ALIAS}.\`LeftVal\` != ''`,
  whereSourceColumns: ["LeftVal"],
  join: {
    table: "join_right",
    alias: "jr",
    kind: "INNER",
    on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\``,
    onSourceColumns: { primary: ["Key"], joined: ["Key"] },
    sourceColumns: ["TenantId", "Key", "RightVal"],
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "tenant",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "Key",
      type: "String",
      description: "join key",
      gates: [],
      sourceColumns: ["Key"],
    },
    {
      name: "LeftVal",
      type: "String",
      description: "value from the left table",
      gates: [],
      sourceColumns: ["LeftVal"],
    },
    {
      name: "RightVal",
      type: "String",
      description: "value from the right (joined) table",
      gates: [],
      sourceColumns: [],
      expression: (_source, joined) => joined!("RightVal"),
    },
  ],
};

describe("given the shipped single-table catalog views", () => {
  const snapshot = JSON.parse(
    readFileSync(joinPath(__dirname, "existingViewSql.snapshot.json"), "utf8"),
  ) as Record<string, string>;

  describe("when each is rendered after the join fields were added", () => {
    for (const name of Object.keys(snapshot)) {
      it(`renders ${name} byte-for-byte as it did before`, () => {
        const view = lwqlViewByName(name);
        expect(
          view,
          `${name} is no longer in the catalog — the snapshot is stale`,
        ).toBeDefined();
        const sql = lwqlViewStatement({
          names: NAMES,
          sourceDatabase: SOURCE_DATABASE,
          view: view!,
          dedup: SHIPPED_LWQL_DEDUP,
        });
        expect(sql).toBe(snapshot[name]);
        // A no-join view names no join alias and adds no second relation.
        expect(sql).not.toContain(" JOIN ");
      });
    }
  });
});

describe("given a catalog view that joins a second table", () => {
  describe("when it is rendered", () => {
    const sql = lwqlViewStatement({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
      view: JOIN_VIEW,
      dedup: SHIPPED_LWQL_DEDUP,
    });

    it("emits the JOIN clause over the joined table with the ON predicate", () => {
      expect(sql).toContain(
        "INNER JOIN langwatch.join_right AS jr ON src.`Key` = jr.`Key`",
      );
    });

    it("reads the joined-side column through the join alias", () => {
      expect(sql).toContain("jr.`RightVal` AS `RightVal`");
      // The left-side columns still qualify with the primary alias.
      expect(sql).toContain("src.`LeftVal` AS `LeftVal`");
    });

    it("applies the pre-filter as a WHERE clause", () => {
      expect(sql).toContain("WHERE src.`LeftVal` != ''");
    });
  });

  describe("when its source tables are enumerated for the row policy", () => {
    it("lists both the primary and the joined table", () => {
      const tables = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        views: [JOIN_VIEW],
      });
      expect(tables.map((table) => table.table).sort()).toEqual([
        "join_left",
        "join_right",
      ]);
      // Both police on the default tenant column.
      for (const table of tables) {
        expect(table.tenantColumn).toBe("TenantId");
        expect(table.database).toBe(SOURCE_DATABASE);
      }
    });
  });

  describe("when the joined-side grant is built", () => {
    it("grants exactly the join's declared source columns on the joined table", () => {
      const grant = lwqlJoinSourceColumnGrantStatement({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        view: JOIN_VIEW,
      });
      expect(grant).toBe(
        "GRANT SELECT(`TenantId`, `Key`, `RightVal`) ON langwatch.join_right " +
          `TO ${NAMES.restrictedUser}`,
      );
    });

    it("returns nothing for a single-table view", () => {
      const traces = lwqlViewByName("traces")!;
      expect(
        lwqlJoinSourceColumnGrantStatement({
          names: NAMES,
          sourceDatabase: SOURCE_DATABASE,
          view: traces,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the full access model is generated", () => {
    const statements = renderLwqlAccessModelDdl(
      buildLwqlAccessModelDefinition({
        names: NAMES,
        passwordSha256Hex: "a".repeat(64),
        namedCollection: NAMED_COLLECTION,
        sourceDatabase: SOURCE_DATABASE,
        views: [JOIN_VIEW],
      }),
    );

    it("creates a row policy for both physical tables", () => {
      for (const table of ["join_left", "join_right"]) {
        expect(
          statements.some((statement) =>
            statement.startsWith(
              `CREATE ROW POLICY OR REPLACE ${table}_tenant ON ${SOURCE_DATABASE}.${table}`,
            ),
          ),
          `${table} must carry a tenant row policy`,
        ).toBe(true);
      }
    });

    it("grants the joined side alongside the primary", () => {
      expect(statements).toContain(
        "GRANT SELECT(`TenantId`, `Key`, `RightVal`) ON langwatch.join_right " +
          `TO ${NAMES.restrictedUser}`,
      );
    });
  });
});

/**
 * A column read only to filter (`where`) or to match (`on`) — never projected —
 * must still be granted, or the restricted read is denied on it at query time
 * (langwatch-saas#... / #8085 step 3 defect: `SELECT(SpanName)` was missing on
 * the joined view's primary table).
 */
describe("given a view whose predicate reads columns no projection does", () => {
  const PREDICATE_ONLY_VIEW: LangWatchQLViewDefinition = {
    ...JOIN_VIEW,
    name: "predicate_probe",
    // `Kind` (primary) and `RightKind` (joined) appear only in where/on.
    where: `${LWQL_SOURCE_ALIAS}.\`Kind\` = 'x'`,
    whereSourceColumns: ["Kind"],
    join: {
      ...JOIN_VIEW.join!,
      on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\` AND jr.\`RightKind\` = 'y'`,
      onSourceColumns: { primary: ["Key"], joined: ["Key", "RightKind"] },
    },
  };

  it("grants the where-only column on the primary table", () => {
    const grant = lwqlSourceColumnGrantStatement({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
      view: PREDICATE_ONLY_VIEW,
    });
    expect(grant).toContain("`Kind`");
  });

  it("grants the on-only column on the joined table", () => {
    const grant = lwqlJoinSourceColumnGrantStatement({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
      view: PREDICATE_ONLY_VIEW,
    });
    expect(grant).toContain("`RightKind`");
  });
});

describe("given a predicate declared without its source columns", () => {
  it("refuses a where with no whereSourceColumns", () => {
    const view: LangWatchQLViewDefinition = {
      ...JOIN_VIEW,
      name: "bad_where",
      whereSourceColumns: undefined,
    };
    expect(() =>
      lwqlViewStatement({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        view,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    ).toThrow(/whereSourceColumns/);
  });

  it("refuses a join with no onSourceColumns", () => {
    const view: LangWatchQLViewDefinition = {
      ...JOIN_VIEW,
      name: "bad_join",
      join: { ...JOIN_VIEW.join!, onSourceColumns: undefined },
    };
    expect(() =>
      lwqlViewStatement({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        view,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    ).toThrow(/onSourceColumns/);
  });
});
