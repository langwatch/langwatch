import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ClickHouse migrations", () => {
  /** @scenario Retention schema migration versions are unique */
  it("uses unique numeric migration versions", () => {
    const migrationDir = resolve(import.meta.dirname, "../../../migrations");
    const versions = readdirSync(migrationDir)
      .map((file) => file.match(/^(\d+)_.*\.sql$/)?.[1])
      .filter((version): version is string => version != null);

    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect(duplicates).toEqual([]);
  });

  /** @scenario The pulled-cost exclusion changes the budget rollup in place */
  it("changes the budget rollup view without dropping its trigger", () => {
    // A materialised view is an insert trigger: a DROP-then-CREATE leaves a
    // gap where a debit is silently dropped, reading as headroom and letting
    // a budget authorise a request it should refuse. MODIFY QUERY swaps the
    // SELECT with the trigger never absent. Static read of the migration
    // text only — see pulledUsageLedger.integration for the live proof.
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../migrations",
        ".",
        "00082_gateway_budget_scope_totals_exclude_pulled.sql",
      ),
      "utf8",
    );
    const executed = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(executed).toContain("MODIFY QUERY");
    expect(executed).not.toMatch(
      // DROP TABLE drops a materialised view too and leaves the same gap;
      // matching only DROP VIEW waved a reopened hole through (verified: the
      // VIEW-only pattern passed a file carrying a stray DROP TABLE of this mv).
      // Scoped to one statement so an unrelated later DROP cannot trip it.
      /DROP\s+(?:VIEW|TABLE)[^;]*gateway_budget_scope_totals_mv/i,
    );
    // The filter this migration exists to add must survive the rewrite.
    expect(executed).toContain("Scope != 'pulled'");
    // 00070's money column: a view that omits it writes an empty aggregate and
    // every calendar-window budget silently reads zero.
    expect(executed).toContain("sumState(AmountNanoUSD)");
  });
});
