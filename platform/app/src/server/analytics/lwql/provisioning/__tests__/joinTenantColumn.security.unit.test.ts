/**
 * A joined source table policed on the tenant column it actually carries
 * (#8085 security finding 3: MEDIUM).
 *
 * `lwqlSourceTables` hard-coded the joined table's tenant column to `TenantId`.
 * A join onto a fact table that spells its project column differently
 * (`project_id`) would then get a row policy filtering a column it does not
 * carry — the policy would fail closed, or worse name the wrong column. The
 * optional `LangWatchQLViewJoin.tenantColumn` fixes it; this pins that the join
 * branch honours it in both the row-policy source list and the emitted policy.
 */
import { describe, expect, it } from "vitest";
import { lwqlNamesForSuite } from "../../__tests__/lwqlClickHouseHarness";
import type { LangWatchQLViewDefinition } from "../../catalog/types";
import { lwqlRowPolicyStatement } from "../accessModel";
import {
  LWQL_SOURCE_ALIAS,
  lwqlSourceTables,
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../catalogStatements";

const NAMES = lwqlNamesForSuite("jointenant");
const SOURCE_DATABASE = "langwatch";

/**
 * A synthetic view joining a default-`TenantId` primary to a `project_id`-keyed
 * fact table. Kept out of the shipped catalog: it exercises the machinery.
 */
const JOIN_VIEW: LangWatchQLViewDefinition = {
  name: "join_tenant_probe",
  sourceTable: "join_left",
  description: "probe: a TenantId primary joined to a project_id-keyed table",
  gates: [],
  grain: "one left row",
  grainColumns: ["TenantId", "Key"],
  joinKeys: [],
  timeColumn: "OccurredAt",
  freshness: "test",
  dedup: { keyColumns: ["TenantId", "Key"], strategy: "none" },
  join: {
    table: "project_scoped_right",
    alias: "jr",
    kind: "INNER",
    on: `${LWQL_SOURCE_ALIAS}.\`Key\` = jr.\`Key\``,
    onSourceColumns: { primary: ["Key"], joined: ["Key"] },
    sourceColumns: ["project_id", "Key", "RightVal"],
    tenantColumn: "project_id",
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
      name: "RightVal",
      type: "String",
      description: "value from the joined table",
      gates: [],
      sourceColumns: [],
      expression: (_source, joined) => joined!("RightVal"),
    },
  ],
};

describe("given a view joining a project_id-keyed fact table", () => {
  describe("when its source tables are enumerated for the row policy", () => {
    const tables = lwqlSourceTables({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
      views: [JOIN_VIEW],
    });

    it("polices the primary on TenantId and the joined table on project_id", () => {
      const byName = new Map(tables.map((t) => [t.table, t.tenantColumn]));
      expect(byName.get("join_left")).toBe("TenantId");
      expect(byName.get("project_scoped_right")).toBe("project_id");
    });
  });

  describe("when the full setup is generated", () => {
    const statements = lwqlViewSetupStatements({
      names: NAMES,
      sourceDatabase: SOURCE_DATABASE,
      views: [JOIN_VIEW],
      dedup: SHIPPED_LWQL_DEDUP,
    });

    it("emits the joined table's row policy filtering project_id", () => {
      const expected = lwqlRowPolicyStatement({
        names: NAMES,
        lwqlTable: {
          table: "project_scoped_right",
          tenantColumn: "project_id",
          database: SOURCE_DATABASE,
        },
        sourceDatabase: SOURCE_DATABASE,
      });
      expect(statements).toContain(expected);
      expect(expected).toContain("project_id IN (SELECT any(TenantId)");
    });
  });

  describe("when the join declares no tenant column", () => {
    it("falls back to the default TenantId", () => {
      const defaultJoin: LangWatchQLViewDefinition = {
        ...JOIN_VIEW,
        name: "join_tenant_default",
        join: { ...JOIN_VIEW.join!, tenantColumn: undefined },
      };
      const tables = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: SOURCE_DATABASE,
        views: [defaultJoin],
      });
      const joined = tables.find((t) => t.table === "project_scoped_right");
      expect(joined?.tenantColumn).toBe("TenantId");
    });
  });
});
