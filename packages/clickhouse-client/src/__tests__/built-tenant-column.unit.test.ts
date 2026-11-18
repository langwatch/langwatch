/**
 * ADR-202, D-SO: a built statement is checked against its own tables' tenant column, so a table
 * keyed on `project_id` passes the client's guard; a raw statement is still checked on TenantId.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { column } from "../builder/expression.ts";
import { clickhouseRead } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { checkTenantScope, TenantGuard, TenantScopeError } from "../tenantGuard.ts";

const storedObjects = defineClickHouseTable({
  name: "stored_objects",
  tenantColumn: "project_id",
  versionColumn: "inserted_at",
  sortKey: ["project_id", "id"],
  columns: {
    project_id: column.string(),
    id: column.string(),
    inserted_at: column.dateTime64({ precision: 3 }),
  },
});

function recordingDriver(): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  const refuse = () => Promise.reject(new Error("not a read"));
  return {
    sent,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request);
      return { rows: [] as Row[] };
    },
    command: refuse,
    insert: refuse,
  };
}

function clientWith() {
  const reader = recordingDriver();
  const client = new ClickHouseQueryClient({
    driver: recordingDriver(),
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader };
}

const lookup = ({ scope }: { scope: ReturnType<typeof tenantScope.single> }) =>
  clickhouseRead({ scope })
    .from(storedObjects)
    .select({ id: storedObjects.id })
    .where(({ eq }) => eq(storedObjects.id, "obj_1"))
    .latestVersion()
    .limit(1)
    .build();

async function violationOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    if (error instanceof TenantScopeError) return error.violation.kind;
    throw error;
  }
  throw new Error("expected a refusal");
}

const scoped = (sql: string, params: Record<string, unknown> = { t: "proj_a" }) =>
  checkTenantScope({ sql, params, tenantId: "proj_a", tenantColumns: ["project_id"] })?.kind ??
  null;

describe("given a built read on a table keyed on its own tenant column", () => {
  describe("when it is built under a single scope", () => {
    /** @scenario "A built read on a table keyed on its own tenant column passes the client's guard" */
    it("names that column as the tenant column its predicates bind", () => {
      const statement = lookup({ scope: tenantScope.single({ tenantId: "proj_a" }) });

      expect(statement.tenantColumns).toEqual(["project_id"]);
      expect(statement.sql).toContain("project_id = {tenantId:String}");
    });
  });

  describe("when the client reads it", () => {
    /** @scenario "A built read on a table keyed on its own tenant column passes the client's guard" */
    it("sends it on the reader with its tenant setting", async () => {
      const { client, reader } = clientWith();
      const statement = lookup({ scope: tenantScope.single({ tenantId: "proj_a" }) });

      await client.read({ statement, table: "stored_objects" });

      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]).toMatchObject({ tenantId: "proj_a", sql: statement.sql });
    });
  });

  describe("when the guard checks the column's own predicate", () => {
    /** @scenario "A built read on a table keyed on its own tenant column passes the client's guard" */
    it.each([
      ["an OR beside it", "SELECT id FROM stored_objects WHERE project_id = {t:String} OR 1 = 1"],
      ["a NOT before it", "SELECT id FROM stored_objects WHERE NOT project_id = {t:String}"],
      ["a literal tenant", "SELECT id FROM stored_objects WHERE project_id = 'proj_a'"],
      ["no predicate", "SELECT id FROM stored_objects WHERE id = {t:String} AND 1"],
    ])("refuses %s as it refuses one on TenantId", (_, sql) => {
      expect(scoped(sql)).not.toBeNull();
    });

    /** @scenario "A built read on a table keyed on its own tenant column passes the client's guard" */
    it("refuses a predicate bound to another tenant", () => {
      const sql = "SELECT id FROM stored_objects WHERE project_id = {t:String}";

      expect(scoped(sql, { t: "proj_b" })).toBe("param-mismatch");
      expect(scoped(sql)).toBeNull();
    });
  });
});

describe("given a raw statement keyed on project_id", () => {
  describe("when it is sent through query()", () => {
    /** @scenario "A raw statement cannot borrow a built statement's tenant column" */
    it("is refused for a missing TenantId predicate", async () => {
      const { client, reader } = clientWith();
      const built = lookup({ scope: tenantScope.single({ tenantId: "proj_a" }) });
      const request = { tenantId: "proj_a", sql: built.sql, params: { ...built.params } };

      expect(await violationOf(() => client.query(request))).toBe("missing-predicate");
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A raw statement cannot borrow a built statement's tenant column" */
    it("is refused even when the request carries the built field", async () => {
      const { client } = clientWith();
      const built = lookup({ scope: tenantScope.single({ tenantId: "proj_a" }) });
      const request = {
        tenantId: "proj_a",
        sql: built.sql,
        params: { ...built.params },
        builtTenantColumns: ["project_id"],
      } as QueryRequest;

      expect(await violationOf(() => client.query(request))).toBe("missing-predicate");
    });
  });
});
