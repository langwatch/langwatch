/**
 * A dataset's row policy filters the project column its source table actually
 * carries, not the literal `TenantId`.
 *
 * Almost every ClickHouse fact table names the owning project `TenantId`, and
 * the row-policy generator used to hard-code that name. One source spells it
 * differently — `stored_objects` carries `project_id` (migration 00023) — so a
 * dataset over it declares the real column on
 * {@link LangWatchQLViewDefinition.tenantColumn}, and this proves the generator
 * threads that declaration all the way into the `CREATE ROW POLICY` text. A
 * policy on the wrong column is not a syntax error: it reads zero rows or, worse,
 * polices nothing, so the assertion is on the exact predicate column.
 *
 * @see ../catalogStatements.ts — lwqlSourceTables, where the column is resolved
 * @see ../accessModel.ts — lwqlRowPolicyStatement, which renders the policy
 * @see specs/lwql/api.feature
 */
import { describe, expect, it } from "vitest";

import type { LangWatchQLViewDefinition } from "../../catalog/types";
import type { LangWatchQLNames } from "../accessModel";
import { lwqlRowPolicyStatement } from "../accessModel";
import { lwqlSourceTables } from "../catalogStatements";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

/**
 * A dataset whose source names the project column `project_id`, exposed under
 * the `TenantId` alias every dataset publishes.
 */
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

/** The same shape on the default column, to prove the default is preserved. */
const TENANT_ID_VIEW: LangWatchQLViewDefinition = {
  ...PROJECT_ID_VIEW,
  name: "scratch_traces",
  sourceTable: "scratch_traces",
  tenantColumn: undefined,
  columns: [
    { ...PROJECT_ID_VIEW.columns[0]!, sourceColumns: ["TenantId"] },
    PROJECT_ID_VIEW.columns[1]!,
  ],
};

describe("given a dataset whose source names its project column project_id", () => {
  describe("when the source tables are derived from the catalog", () => {
    it("carries project_id as that source's tenant column", () => {
      const [table] = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [PROJECT_ID_VIEW],
      });
      expect(table?.table).toBe("scratch_objects");
      expect(table?.tenantColumn).toBe("project_id");
    });

    it("keeps TenantId as the default for a source that declares none", () => {
      const [table] = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [TENANT_ID_VIEW],
      });
      expect(table?.tenantColumn).toBe("TenantId");
    });
  });

  describe("when the row policy is rendered", () => {
    it("filters project_id, not the literal TenantId", () => {
      const [lwqlTable] = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [PROJECT_ID_VIEW],
      });
      const statement = lwqlRowPolicyStatement({
        names: NAMES,
        lwqlTable: lwqlTable!,
        sourceDatabase: NAMES.database,
      });
      expect(statement).toContain("ON langwatch.scratch_objects");
      // The predicate opens on the source's own column, and the key map's
      // TenantId (the mapped-to value) is untouched.
      expect(statement).toContain(
        "USING project_id IN (SELECT any(TenantId) FROM langwatch.lwql_api_key_tenant_map",
      );
      expect(statement).not.toContain("USING TenantId IN");
    });

    it("filters TenantId for a source on the default column", () => {
      const [lwqlTable] = lwqlSourceTables({
        names: NAMES,
        sourceDatabase: NAMES.database,
        views: [TENANT_ID_VIEW],
      });
      const statement = lwqlRowPolicyStatement({
        names: NAMES,
        lwqlTable: lwqlTable!,
        sourceDatabase: NAMES.database,
      });
      expect(statement).toContain("USING TenantId IN (SELECT any(TenantId)");
    });
  });
});
