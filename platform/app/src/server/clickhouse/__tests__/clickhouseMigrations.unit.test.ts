import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ClickHouse migrations", () => {
  /** @scenario Retention schema migration versions are unique */
  it("uses unique numeric migration versions", () => {
    const migrationDir = resolve(
      process.cwd(),
      "src/server/clickhouse/migrations",
    );
    const versions = readdirSync(migrationDir)
      .map((file) => file.match(/^(\d+)_.*\.sql$/)?.[1])
      .filter((version): version is string => version != null);

    const duplicates = versions.filter(
      (version, index) => versions.indexOf(version) !== index,
    );

    expect(duplicates).toEqual([]);
  });

  /** @scenario The budget spend rollup keeps folding while its filter changes */
  it("changes the budget rollup view without dropping its trigger", () => {
    // A materialised view is an insert trigger. Between a DROP and the
    // following CREATE there is no trigger, ClickHouse does not replay the
    // inserts made in that window, and this migration has no delta replay —
    // so a successful debit landing in the gap is absent from
    // gateway_budget_scope_totals permanently. Enforcement sums that rollup
    // (getSpendForBudgets* reads sumMerge(SpendNanoUSD)), so the missing money
    // reads as headroom and a budget authorises a request it should refuse.
    // MODIFY QUERY swaps the SELECT with the trigger never absent.
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "src/server/clickhouse/migrations",
        "00077_gateway_budget_scope_totals_exclude_pulled.sql",
      ),
      "utf8",
    );
    const executed = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(executed).toContain("MODIFY QUERY");
    expect(executed).not.toMatch(
      /DROP\s+VIEW[\s\S]*gateway_budget_scope_totals_mv/i,
    );
    // The filter this migration exists to add must survive the rewrite.
    expect(executed).toContain("Scope != 'pulled'");
    // 00070's money column: a view that omits it writes an empty aggregate and
    // every calendar-window budget silently reads zero.
    expect(executed).toContain("sumState(AmountNanoUSD)");
  });
});
