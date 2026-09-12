// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Guard: the rollup's sort key exists in three places, and nothing at runtime
 * forces them to agree.
 *
 *   1. The table's own `ORDER BY` in migration 00092 — what ClickHouse
 *      actually dedupes and prunes on.
 *   2. `GOVERNANCE_COST_ROLLUP_KEY_FIELDS`, the order the fold packs into the
 *      key a cell is addressed by.
 *   3. `KEY_COLUMNS` on the read side, which builds the point-lookup
 *      predicate.
 *
 * A reorder in any one of them is silent. If the fold's order drifts from the
 * table's, two different dimension tuples can still encode to distinct keys,
 * so nothing throws — the rows just land under an address the read side
 * cannot reproduce, and money rows go missing or a lookup returns a
 * neighbouring cell's amount. If `KEY_COLUMNS` drifts, the predicate stops
 * being a prefix of the sort key and the point lookup degrades to a scan.
 * This test is the only thing that notices any of it.
 *
 * The migration is read as text on purpose: it is the deployed DDL, and it is
 * immutable history, so it is the fixed end of the contract that the two
 * TypeScript copies are held against.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_COLUMNS } from "../../services/governanceCostRollup.clickhouse.repository";
import { GOVERNANCE_COST_ROLLUP_TABLE } from "../governanceCostRollup.constants";
import { GOVERNANCE_COST_ROLLUP_KEY_FIELDS } from "../governanceCostRollup.foldProjection";

const MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    "src/server/clickhouse/migrations/00092_create_governance_cost_rollup_1d.sql",
  ),
  "utf8",
);

/**
 * The column list of the migration's `ORDER BY (...)`. Throws rather than
 * returning something empty: a parse that quietly found nothing would make
 * every assertion below vacuous, which is the failure mode this whole file
 * exists to rule out.
 */
function orderByColumns(sql: string): string[] {
  const clauses = [...sql.matchAll(/^ORDER BY \(([^)]*)\)/gm)];
  if (clauses.length !== 1) {
    throw new Error(
      `expected exactly one ORDER BY in migration 00092, found ${clauses.length}`,
    );
  }
  const columns = clauses[0]![1]!.split(",").map((column) => column.trim());
  if (columns.length === 0 || columns.some((column) => column === "")) {
    throw new Error(`unparseable ORDER BY column list: ${clauses[0]![1]!}`);
  }
  return columns;
}

/** `tenantId` → `TenantId`: the two sides spell the same dimension differently. */
function asColumnName(field: string): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

describe("the governance cost rollup sort key", () => {
  describe("given the deployed table definition in migration 00092", () => {
    it("parses a non-empty ORDER BY off the rollup table", () => {
      // The self-check: everything below compares against this list, so a
      // silently-empty parse would turn the guard green while pinning nothing.
      expect(MIGRATION).toContain(GOVERNANCE_COST_ROLLUP_TABLE);
      expect(orderByColumns(MIGRATION).length).toBeGreaterThan(0);
    });

    it("orders the read side's key columns exactly as the table does", () => {
      expect([...KEY_COLUMNS]).toEqual(orderByColumns(MIGRATION));
    });

    it("orders the fold's key fields exactly as the table does", () => {
      expect(GOVERNANCE_COST_ROLLUP_KEY_FIELDS.map(asColumnName)).toEqual(
        orderByColumns(MIGRATION),
      );
    });
  });
});
