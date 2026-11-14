/**
 * System tables only the system identity reads (ADR-202): an all-tenants read of them builds,
 * every reader scope refuses them at compile time and at run time.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import * as reads from "../../__tests__/fixtures/system-identity-reads.ts";
import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { QueryBuilderError } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { systemColumns, systemMutations, systemParts, systemTables } from "../system-tables.ts";

const BUILT = {
  "storage footprint": reads.footprintTablesRead({ tables: ["stored_spans", "event_log"] }),
  disks: reads.footprintDisksRead(),
  "backup log presence": reads.hasBackupLogRead(),
  "backup statuses": reads.backupStatusesRead(),
  "held tables": reads.heldTablesRead({ tables: ["event_log_id_index"] }),
  "mutation progress": reads.mutationProgressRead({ needle: "TenantId = 'project_a'" }),
  "keep-forever rewrites": reads.keepForeverRewritesRead({ tables: ["event_log"] }),
};

function refusalOf(build: () => unknown): QueryBuilderError {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("given an all-tenants scope", () => {
  describe("when it reads a system table only the system identity reads", () => {
    /** @scenario "An all-tenants read names the system tables only the system identity reads" */
    it.each(Object.entries(BUILT))(
      "builds the %s read as a system statement with no tenant setting or predicate",
      (_, statement) => {
        expect(statement.identity).toBe("system");
        expect(statement.kind).toBe("allTenants");
        expect(statement.settings).not.toHaveProperty(TENANT_IDS_SETTING);
        expect(statement.sql).not.toMatch(/TenantId|'/);
      },
    );

    /** @scenario "An all-tenants read names the system tables only the system identity reads" */
    it("binds the needle, the format and every compared value of the mutation progress read", () => {
      const statement = BUILT["mutation progress"];

      expect(statement.sql).toBe(
        "SELECT mutation_id AS mutationId, table, is_done AS isDone, parts_to_do AS partsToDo, " +
          "formatDateTime(create_time, {v0:String}) AS createTime, command FROM system.mutations " +
          "WHERE (position(command, {v1:String}) > {v2:UInt64} AND position(command, {v3:String}) " +
          "> {v4:UInt64} AND is_done = {v5:UInt8}) ORDER BY create_time DESC",
      );
      expect(statement.params).toEqual({
        v0: "%Y-%m-%dT%H:%i:%S",
        v1: "_retention_days",
        v2: 0,
        v3: "TenantId = 'project_a'",
        v4: 0,
        v5: 0,
      });
    });
  });

  describe("when it names a system table on neither list", () => {
    /** @scenario "A system table naming other tenants is refused on every reader scope" */
    it("refuses a descriptor relabelled to system.query_log", () => {
      const queryLog = {
        ...systemMutations,
        $table: { ...systemMutations.$table, name: "system.query_log", stored: "system.query_log" },
      };

      // wrong-typed input: proves the run-time allow-list refuses what the types would
      const error = refusalOf(() =>
        clickhouseRead({ scope: tenantScope.allTenants({ reason: "a sweep" }) }).from(
          queryLog as unknown as typeof systemMutations,
        ),
      );

      expect(error.violation).toMatchObject({
        kind: "table-outside-scope",
        table: "system.query_log",
        scope: "allTenants",
      });
    });

    /** @scenario "A system table naming other tenants is refused on every reader scope" */
    it("refuses a server-metadata table, which the reader reads, at compile time and at run time", () => {
      const error = refusalOf(() =>
        clickhouseRead({ scope: tenantScope.allTenants({ reason: "a sweep" }) })
          // @ts-expect-error server metadata is the reader's; an all-tenants read does not name it
          .from(systemColumns),
      );

      expect(error.violation).toMatchObject({
        kind: "table-outside-scope",
        table: "system.columns",
      });
    });
  });
});

describe("given a reader scope", () => {
  const scopes = [
    tenantScope.serverMetadata({ reason: "the schema's column list" }),
    tenantScope.single({ tenantId: "project_a" }),
    tenantScope.set({ tenantIds: ["project_a", "project_b"] }),
  ];

  describe("when it names a system table only the system identity reads", () => {
    for (const scope of scopes) {
      for (const table of [systemMutations, systemParts, systemTables]) {
        /** @scenario "A system table naming other tenants is refused on every reader scope" */
        it(`refuses ${table.$table.stored} under a ${scope.kind} scope`, () => {
          // wrong-typed input: proves the run-time allow-list refuses what the types would
          const error = refusalOf(() =>
            clickhouseRead({ scope }).from(table as unknown as typeof systemColumns),
          );

          expect(error.violation).toEqual({
            kind: "table-outside-scope",
            table: table.$table.stored,
            scope: scope.kind,
          });
        });
      }
    }

    /** @scenario "A system table naming other tenants is refused on every reader scope" */
    it("does not type-check under server metadata or a tenant scope", () => {
      const metadata = () =>
        clickhouseRead({ scope: tenantScope.serverMetadata({ reason: "x" }) })
          // @ts-expect-error only the system identity reads system.mutations
          .from(systemMutations);
      const single = () =>
        clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
          // @ts-expect-error a tenant scope reads tenant tables and bound rows only
          .from(systemMutations);

      expect(refusalOf(metadata).violation.kind).toBe("table-outside-scope");
      expect(refusalOf(single).violation.kind).toBe("table-outside-scope");
    });

    /** @scenario "A system table naming other tenants is refused on every reader scope" */
    it("refuses system.mutations relabelled as server metadata, by the allow-list", () => {
      const relabelled = {
        ...systemMutations,
        $table: { ...systemMutations.$table, kind: "system" as const },
      };

      // wrong-typed input: proves the run-time allow-list refuses what the types would
      const error = refusalOf(() =>
        clickhouseRead({ scope: tenantScope.serverMetadata({ reason: "x" }) }).from(
          relabelled as unknown as typeof systemColumns,
        ),
      );

      expect(error.violation).toMatchObject({
        kind: "table-outside-scope",
        table: "system.mutations",
        scope: "serverMetadata",
      });
    });
  });
});
