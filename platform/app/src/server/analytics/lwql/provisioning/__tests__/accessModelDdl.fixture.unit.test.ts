/**
 * Byte-identity guard for the access-statement move (issue #8258).
 *
 * The access-statement builders moved from `accessModel.ts` to
 * `accessModelDdl.ts`. This captures `lwqlClickHouseSetupStatements` output for
 * fixed inputs as a committed snapshot, so the move — and any later edit to the
 * builders — is proven byte-for-byte against the shipped statements rather than
 * eyeballed. `includeAppFunctions: false` keeps the snapshot to the access model
 * and independent of the app-function catalog.
 *
 * @see ../accessModelDdl.ts
 * @scenario "The DDL emitter output is byte-identical to the shipped access statements"
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames, LangWatchQLTable } from "../accessModel";
import { lwqlClickHouseSetupStatements } from "../accessModelDdl";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const LWQL_TABLES: LangWatchQLTable[] = [
  { table: "trace_summaries", tenantColumn: "TenantId", database: "langwatch" },
  {
    table: "stored_objects",
    tenantColumn: "project_id",
    database: "langwatch",
  },
];

describe("lwqlClickHouseSetupStatements after the accessModelDdl move", () => {
  describe("given fixed names, password and tables", () => {
    it("emits the shipped access statements byte-for-byte", () => {
      const statements = lwqlClickHouseSetupStatements({
        names: NAMES,
        password: "s3cr3t-lwql",
        lwqlTables: LWQL_TABLES,
        sourceDatabase: "langwatch",
        includeAppFunctions: false,
      });

      expect(statements).toMatchSnapshot();
    });

    it("omits the access statements in rendered mode, keeping the structural ones", () => {
      const rendered = lwqlClickHouseSetupStatements({
        names: NAMES,
        password: "s3cr3t-lwql",
        lwqlTables: LWQL_TABLES,
        sourceDatabase: "langwatch",
        includeAppFunctions: false,
        includeAccessStatements: false,
      });

      // Only the database and the key-map table survive; no profile, user,
      // grant or row policy.
      expect(rendered).toEqual([
        "CREATE DATABASE IF NOT EXISTS langwatch",
        "CREATE TABLE IF NOT EXISTS langwatch.lwql_api_key_tenant_map " +
          "(KeyHash String, TenantId String) ENGINE = MergeTree ORDER BY KeyHash",
      ]);
      expect(rendered.some((s) => s.includes("CREATE USER"))).toBe(false);
      expect(rendered.some((s) => s.includes("ROW POLICY"))).toBe(false);
      expect(rendered.some((s) => s.startsWith("GRANT"))).toBe(false);
    });
  });
});
