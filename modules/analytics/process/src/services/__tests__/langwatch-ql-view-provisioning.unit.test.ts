/**
 * The provisioning SQL for a view's tenant column and for a two-table view, pinned as text: a
 * policy on the wrong column or an ungranted predicate column is not a syntax error.
 * @see ../../langwatch-ql/__tests__/catalog-view-join.integration.test.ts (over ClickHouse)
 * @see specs/lwql/api.feature
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LWQL_SOURCE_ALIAS } from "../../rules/lwql-source-alias.rules.ts";
import { lwqlViewByName } from "../../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../langwatch-ql-access-model.service.ts";
import type { LangWatchQLViewDefinition } from "../langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLViewProvisioningService } from "../langwatch-ql-view-provisioning.service.ts";
import {
  LangWatchQLViewStatementsService,
  SHIPPED_LWQL_DEDUP,
} from "../langwatch-ql-view-statements.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

const SOURCE_DATABASE = "langwatch";

/** The names the snapshot fixture was captured under (`lwqlNamesForSuite("snap")`). */
const SNAPSHOT_NAMES: LangWatchQLNames = {
  database: "lwql_snap",
  restrictedUser: "lwql_snap_reader",
  settingsProfile: "lwql_snap_profile",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

/** A dataset whose source names the project column `project_id`, published as `TenantId`. */
const PROJECT_ID_VIEW: LangWatchQLViewDefinition = {
  name: "scratch_objects",
  sourceTable: "scratch_objects",
  description: "A synthetic project_id-keyed dataset for the row-policy proof.",
  gates: [],
  grain: "one row per (project_id, ObjectId)",
  grainColumns: ["TenantId", "ObjectId"],
  joinKeys: ["TenantId"],
  timeColumn: "CreatedAt",
  freshness: "seconds",
  tenantColumn: "project_id",
  dedup: { strategy: "none", keyColumns: ["TenantId", "ObjectId"] },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Owning project.",
      gates: [],
      sourceColumns: ["project_id"],
    },
    {
      name: "ObjectId",
      type: "String",
      description: "Stored object id.",
      gates: [],
      sourceColumns: ["ObjectId"],
    },
  ],
};

const TENANT_ID_VIEW: LangWatchQLViewDefinition = {
  ...PROJECT_ID_VIEW,
  name: "scratch_traces",
  sourceTable: "scratch_traces",
  tenantColumn: undefined,
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Owning project.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "ObjectId",
      type: "String",
      description: "Stored object id.",
      gates: [],
      sourceColumns: ["ObjectId"],
    },
  ],
};

/** `join_left` joined to `join_right` on `Key`, with a pre-filter and a column from each side. */
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
    { name: "Key", type: "String", description: "join key", gates: [], sourceColumns: ["Key"] },
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
      expression: (_source, joined) => (joined ? joined("RightVal") : "NULL"),
    },
  ],
};

const JOIN_RIGHT = {
  table: "join_right",
  alias: "jr",
  kind: "INNER",
  on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\``,
  onSourceColumns: { primary: ["Key"], joined: ["Key"] },
  sourceColumns: ["TenantId", "Key", "RightVal"],
} as const;

const joinGrant = `GRANT SELECT(\`TenantId\`, \`Key\`, \`RightVal\`) ON langwatch.join_right TO ${SNAPSHOT_NAMES.restrictedUser}`;

describe("given a dataset whose source names its project column project_id", () => {
  describe("when the source tables are derived from the catalog", () => {
    it("carries project_id as that source's tenant column", () => {
      const [table] = viewProvisioning.sourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [PROJECT_ID_VIEW],
      });

      expect(table?.table).toBe("scratch_objects");
      expect(table?.tenantColumn).toBe("project_id");
    });

    it("keeps TenantId as the default for a source that declares none", () => {
      const [table] = viewProvisioning.sourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [TENANT_ID_VIEW],
      });

      expect(table?.tenantColumn).toBe("TenantId");
    });
  });

  describe("when the row policy is rendered", () => {
    const policyFor = (view: LangWatchQLViewDefinition): string => {
      const [lwqlTable] = viewProvisioning.sourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [view],
      });
      if (!lwqlTable) throw new Error(`no source table for ${view.name}`);

      return accessModel.rowPolicyStatement({ names: NAMES, lwqlTable });
    };

    it("filters project_id, not the literal TenantId", () => {
      const statement = policyFor(PROJECT_ID_VIEW);

      expect(statement).toContain("ON langwatch.scratch_objects");
      expect(statement).toContain(
        "USING project_id IN (SELECT any(TenantId) FROM langwatch.lwql_api_key_tenant_map",
      );
      expect(statement).not.toContain("USING TenantId IN");
    });

    it("filters TenantId for a source on the default column", () => {
      expect(policyFor(TENANT_ID_VIEW)).toContain("USING TenantId IN (SELECT any(TenantId)");
    });
  });
});

describe("given the shipped single-table catalog views", () => {
  const snapshot: Record<string, string> = JSON.parse(
    readFileSync(new URL("./fixtures/existing-view-sql.snapshot.json", import.meta.url), "utf8"),
  );

  describe("when each is rendered after the join fields were added", () => {
    for (const name of Object.keys(snapshot)) {
      it(`renders ${name} byte-for-byte as it did before`, () => {
        const view = lwqlViewByName(name);
        if (!view) throw new Error(`${name} is no longer in the catalog — the snapshot is stale`);
        const sql = viewStatements.viewStatement({
          names: SNAPSHOT_NAMES,
          sourceDatabase: SOURCE_DATABASE,
          view,
          dedup: SHIPPED_LWQL_DEDUP,
        });

        expect(sql).toBe(snapshot[name]);
        expect(sql).not.toContain(" JOIN ");
      });
    }
  });
});

describe("given a catalog view that joins a second table", () => {
  describe("when it is rendered", () => {
    const sql = viewStatements.viewStatement({
      names: SNAPSHOT_NAMES,
      sourceDatabase: SOURCE_DATABASE,
      view: JOIN_VIEW,
      dedup: SHIPPED_LWQL_DEDUP,
    });

    it("emits the JOIN clause over the joined table with the ON predicate", () => {
      expect(sql).toContain("INNER JOIN langwatch.join_right AS jr ON src.`Key` = jr.`Key`");
    });

    it("reads the joined-side column through the join alias", () => {
      expect(sql).toContain("jr.`RightVal` AS `RightVal`");
      expect(sql).toContain("src.`LeftVal` AS `LeftVal`");
    });

    it("applies the pre-filter as a WHERE clause", () => {
      expect(sql).toContain("WHERE src.`LeftVal` != ''");
    });
  });

  describe("when its source tables are enumerated for the row policy", () => {
    it("lists both the primary and the joined table, each on the default tenant column", () => {
      const tables = viewProvisioning.sourceTables({
        names: SNAPSHOT_NAMES,
        sourceDatabase: SOURCE_DATABASE,
        views: [JOIN_VIEW],
      });

      expect(tables.map((table) => table.table).toSorted()).toEqual(["join_left", "join_right"]);
      for (const table of tables) {
        expect(table.tenantColumn).toBe("TenantId");
        expect(table.database).toBe(SOURCE_DATABASE);
      }
    });
  });

  describe("when the joined-side grant is built", () => {
    it("grants exactly the join's declared source columns on the joined table", () => {
      expect(
        viewStatements.joinSourceColumnGrantStatement({
          names: SNAPSHOT_NAMES,
          sourceDatabase: SOURCE_DATABASE,
          view: JOIN_VIEW,
        }),
      ).toBe(joinGrant);
    });

    it("returns nothing for a single-table view", () => {
      const traces = lwqlViewByName("traces");
      if (!traces) throw new Error("traces is not in the catalog");

      expect(
        viewStatements.joinSourceColumnGrantStatement({
          names: SNAPSHOT_NAMES,
          sourceDatabase: SOURCE_DATABASE,
          view: traces,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the full setup is generated", () => {
    const statements = viewProvisioning.setupStatements({
      names: SNAPSHOT_NAMES,
      sourceDatabase: SOURCE_DATABASE,
      views: [JOIN_VIEW],
      dedup: SHIPPED_LWQL_DEDUP,
    });

    it("creates a row policy for both physical tables", () => {
      for (const table of ["join_left", "join_right"]) {
        expect(statements).toContain(
          accessModel.rowPolicyStatement({
            names: SNAPSHOT_NAMES,
            lwqlTable: { table, tenantColumn: "TenantId", database: SOURCE_DATABASE },
          }),
        );
      }
    });

    it("grants the joined side alongside the primary", () => {
      expect(statements).toContain(joinGrant);
    });
  });
});

describe("given a view whose predicate reads columns no projection does", () => {
  const predicateOnlyView: LangWatchQLViewDefinition = {
    ...JOIN_VIEW,
    name: "predicate_probe",
    where: `${LWQL_SOURCE_ALIAS}.\`Kind\` = 'x'`,
    whereSourceColumns: ["Kind"],
    join: {
      ...JOIN_RIGHT,
      on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\` AND jr.\`RightKind\` = 'y'`,
      onSourceColumns: { primary: ["Key"], joined: ["Key", "RightKind"] },
    },
  };

  it("grants the where-only column on the primary table", () => {
    expect(
      viewStatements.sourceColumnGrantStatement({
        names: SNAPSHOT_NAMES,
        sourceDatabase: SOURCE_DATABASE,
        view: predicateOnlyView,
      }),
    ).toContain("`Kind`");
  });

  it("grants the on-only column on the joined table", () => {
    expect(
      viewStatements.joinSourceColumnGrantStatement({
        names: SNAPSHOT_NAMES,
        sourceDatabase: SOURCE_DATABASE,
        view: predicateOnlyView,
      }),
    ).toContain("`RightKind`");
  });
});

describe("given a predicate declared without its source columns", () => {
  const render = (view: LangWatchQLViewDefinition) => () =>
    viewStatements.viewStatement({
      names: SNAPSHOT_NAMES,
      sourceDatabase: SOURCE_DATABASE,
      view,
      dedup: SHIPPED_LWQL_DEDUP,
    });

  it("refuses a where with no whereSourceColumns", () => {
    expect(render({ ...JOIN_VIEW, name: "bad_where", whereSourceColumns: undefined })).toThrow(
      /whereSourceColumns/,
    );
  });

  it("refuses a join with no onSourceColumns", () => {
    expect(
      render({
        ...JOIN_VIEW,
        name: "bad_join",
        join: { ...JOIN_RIGHT, onSourceColumns: undefined },
      }),
    ).toThrow(/onSourceColumns/);
  });
});

describe("given a view joining a project_id-keyed fact table", () => {
  const projectScopedJoin: LangWatchQLViewDefinition = {
    ...JOIN_VIEW,
    name: "join_tenant_probe",
    where: undefined,
    whereSourceColumns: undefined,
    join: {
      ...JOIN_RIGHT,
      table: "project_scoped_right",
      sourceColumns: ["project_id", "Key", "RightVal"],
      tenantColumn: "project_id",
    },
  };

  describe("when its source tables are enumerated for the row policy", () => {
    it("polices the primary on TenantId and the joined table on project_id", () => {
      const byName = new Map(
        viewProvisioning
          .sourceTables({
            names: NAMES,
            sourceDatabase: SOURCE_DATABASE,
            views: [projectScopedJoin],
          })
          .map((table) => [table.table, table.tenantColumn]),
      );

      expect(byName.get("join_left")).toBe("TenantId");
      expect(byName.get("project_scoped_right")).toBe("project_id");
    });
  });

  describe("when the full setup is generated", () => {
    it("emits the joined table's row policy filtering project_id", () => {
      const expected = accessModel.rowPolicyStatement({
        names: NAMES,
        lwqlTable: {
          table: "project_scoped_right",
          tenantColumn: "project_id",
          database: SOURCE_DATABASE,
        },
      });

      expect(
        viewProvisioning.setupStatements({
          names: NAMES,
          sourceDatabase: SOURCE_DATABASE,
          views: [projectScopedJoin],
          dedup: SHIPPED_LWQL_DEDUP,
        }),
      ).toContain(expected);
      expect(expected).toContain("project_id IN (SELECT any(TenantId)");
    });
  });

  describe("when the join declares no tenant column", () => {
    it("falls back to the default TenantId", () => {
      const joined = viewProvisioning
        .sourceTables({
          names: NAMES,
          sourceDatabase: SOURCE_DATABASE,
          views: [{ ...projectScopedJoin, join: { ...JOIN_RIGHT, table: "project_scoped_right" } }],
        })
        .find((table) => table.table === "project_scoped_right");

      expect(joined?.tenantColumn).toBe("TenantId");
    });
  });
});
