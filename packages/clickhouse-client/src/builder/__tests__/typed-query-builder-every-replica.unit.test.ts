/**
 * A system-identity table read on every replica of a cluster (ADR-202): an all-tenants read renders
 * `clusterAllReplicas` with the cluster bound as an identifier, and every reader scope refuses it.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { column, cond } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { systemBackupLog, systemColumns, systemTables } from "../system-tables.ts";
import { defineClickHouseTable, everyReplica } from "../table.ts";

const allTenants = (reason: string) =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason }) });

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
  describe("when it reads the backup log on every replica of a cluster", () => {
    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("renders clusterAllReplicas with the cluster bound as an identifier, never written", () => {
      const created = cond.eq(systemBackupLog.status, "BACKUP_CREATED");
      const statement = allTenants("the instance's backup history")
        .from(everyReplica({ table: systemBackupLog, cluster: "prod_cluster" }))
        .select({
          status: systemBackupLog.status,
          cnt: fn.count(),
          last_success_time: fn.maxIf(systemBackupLog.end_time, created),
        })
        .groupBy(systemBackupLog.status)
        .settings({ skip_unavailable_shards: 1 })
        .build();

      expect(statement.sql).toBe(
        "SELECT status, count() AS cnt, maxIf(end_time, status = {v0:String}) AS last_success_time " +
          "FROM clusterAllReplicas({v1:Identifier}, system.backup_log) GROUP BY status " +
          "SETTINGS skip_unavailable_shards = 1",
      );
      expect(statement.params).toEqual({ v0: "BACKUP_CREATED", v1: "prod_cluster" });
      expect(statement).toMatchObject({ identity: "system", kind: "allTenants" });
      expect(statement.settings).not.toHaveProperty(TENANT_IDS_SETTING);
    });

    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("reads system.tables on every replica with the filters bound", () => {
      const statement = allTenants("whether the server keeps a backup log")
        .from(everyReplica({ table: systemTables, cluster: "default" }))
        .select({ present: fn.count() })
        .where(({ and, eq }) =>
          and(eq(systemTables.database, "system"), eq(systemTables.name, "backup_log")),
        )
        .build();

      expect(statement.sql).toBe(
        "SELECT count() AS present FROM clusterAllReplicas({v0:Identifier}, system.tables) " +
          "WHERE (database = {v1:String} AND name = {v2:String})",
      );
      expect(statement.params).toEqual({ v0: "default", v1: "system", v2: "backup_log" });
    });

    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("leaves the table's own descriptor reading the local node", () => {
      everyReplica({ table: systemTables, cluster: "default" });

      const statement = allTenants("the local tables")
        .from(systemTables)
        .select({ name: systemTables.name })
        .build();

      expect(statement.sql).toBe("SELECT name FROM system.tables");
    });
  });

  describe("when the cluster or the table is not one every replica is read for", () => {
    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it.each(["", "default'", "x'); DROP TABLE t; --", "a.b"])(
      "refuses the cluster name %j",
      (cluster) => {
        const error = refusalOf(() => everyReplica({ table: systemBackupLog, cluster }));

        expect(error.violation).toEqual({ kind: "bad-cluster", name: cluster });
      },
    );

    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("refuses a server-metadata table and a tenant table, at compile time and at run time", () => {
      const spans = defineClickHouseTable({
        name: "stored_spans",
        tenantColumn: "TenantId",
        sortKey: ["TenantId"],
        columns: { TenantId: column.string() },
      });

      const metadata = refusalOf(() =>
        // @ts-expect-error server metadata is the reader's; it is never read on every replica
        everyReplica({ table: systemColumns, cluster: "default" }),
      );
      const tenant = refusalOf(() =>
        // @ts-expect-error a tenant table is never read on every replica
        everyReplica({ table: spans, cluster: "default" }),
      );

      expect(metadata.violation).toEqual({
        kind: "not-every-replica-table",
        table: "system.columns",
      });
      expect(tenant.violation).toEqual({ kind: "not-every-replica-table", table: "stored_spans" });
    });
  });
});

describe("given a reader scope", () => {
  const scopes = [
    tenantScope.serverMetadata({ reason: "the schema's column list" }),
    tenantScope.single({ tenantId: "project_a" }),
    tenantScope.set({ tenantIds: ["project_a", "project_b"] }),
  ];
  const replicated = everyReplica({ table: systemBackupLog, cluster: "default" });

  describe("when it names a system table read on every replica", () => {
    for (const scope of scopes) {
      /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
      it(`refuses it under a ${scope.kind} scope`, () => {
        // wrong-typed input: proves the run-time check refuses what the types would
        const error = refusalOf(() =>
          clickhouseRead({ scope }).from(replicated as unknown as typeof systemColumns),
        );

        expect(error.violation).toEqual({
          kind: "table-outside-scope",
          table: "system.backup_log",
          scope: scope.kind,
        });
      });
    }

    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("does not type-check under a tenant scope", () => {
      const single = () =>
        clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
          // @ts-expect-error only the system identity reads every replica's backup log
          .from(replicated);

      expect(refusalOf(single).violation.kind).toBe("table-outside-scope");
    });

    /** @scenario "An all-tenants read names a system table on every replica of a cluster" */
    it("refuses a tenant table whose descriptor was given a cluster by hand", () => {
      const spans = defineClickHouseTable({
        name: "stored_spans",
        tenantColumn: "TenantId",
        sortKey: ["TenantId"],
        columns: { TenantId: column.string() },
      });
      const forged = { ...spans, $table: { ...spans.$table, cluster: "default" } };

      const error = refusalOf(() =>
        clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) }).from(forged),
      );

      expect(error.violation).toEqual({
        kind: "table-outside-scope",
        table: "stored_spans",
        scope: "single",
      });
    });
  });
});
