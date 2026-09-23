import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type MigrationSource,
  formatFindings,
  parseBaseline,
  scanClickHouseMigration,
} from "./migration-safety.rules.ts";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

/**
 * The newest migration the baseline was recorded from. goose names sort by
 * sequence number, so anything written after the freeze sorts above this —
 * which is what makes "never extend the baseline" checkable. ADR-155.
 */
const BASELINE_FROZEN_AT = "00099_coding_agent_sessions_usage_by_context.sql";

const baseline = parseBaseline(
  readFileSync(resolve(import.meta.dirname, "migration-safety.baseline.txt"), "utf8"),
);

const migrations: MigrationSource[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .toSorted()
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8") }));

const unshipped = migrations.filter((migration) => !baseline.includes(migration.name));

const scan = (sql: string) => scanClickHouseMigration({ name: "00999_fixture.sql", sql });
const rules = (sql: string) => scan(sql).map((finding) => finding.rule);

describe("ClickHouse migration safety", () => {
  it("leaves every migration newer than the baseline safe in both directions", () => {
    const findings = unshipped.flatMap(scanClickHouseMigration);
    expect(findings, `\n${formatFindings(findings)}\n`).toEqual([]);
  });

  describe("the rules", () => {
    /** @scenario "Dropping a ClickHouse column or table without a note is refused by name" */
    it("refuses a drop with no retirement note, naming the object", () => {
      const findings = scan("-- +goose Up\nALTER TABLE ${D}.spans DROP COLUMN `Legacy`;\n");
      expect(findings[0]?.rule).toBe("drop-without-retirement-note");
      expect(findings[0]?.problem).toContain("Legacy");
      expect(
        rules("-- +goose Up\n-- contract: retired in 1.42.0\nDROP TABLE old_spans;\n"),
      ).toEqual([]);
    });

    /** @scenario "Changing a ClickHouse column type without a note is refused by name" */
    it("refuses a type change, and says to add a column instead", () => {
      const findings = scan("-- +goose Up\nALTER TABLE t MODIFY COLUMN `Cost` Float64;\n");
      expect(findings[0]?.rule).toBe("modify-column-type");
      expect(findings[0]?.problem).toContain("Cost");
      expect(findings[0]?.fix).toContain("switch the readers");
    });

    /** @scenario "A settings-only MODIFY COLUMN is accepted" */
    it("accepts a MODIFY COLUMN that only sets a TTL, CODEC or comment", () => {
      expect(rules("-- +goose Up\nALTER TABLE t MODIFY COLUMN `Body` CODEC(ZSTD(3));\n")).toEqual(
        [],
      );
      expect(
        rules("-- +goose Up\nALTER TABLE t MODIFY COLUMN `At` TTL At + INTERVAL 7 DAY;\n"),
      ).toEqual([]);
    });

    /** @scenario "A variable-size column added without a default is refused by name" */
    it("refuses a variable-size column with no DEFAULT, and accepts one with it", () => {
      const findings = scan("-- +goose Up\nALTER TABLE t ADD COLUMN `Tags` Array(String);\n");
      expect(findings[0]?.rule).toBe("add-variable-size-column-without-default");
      expect(findings[0]?.problem).toContain("Tags");
      expect(
        rules("-- +goose Up\nALTER TABLE t ADD COLUMN `Tags` Array(String) DEFAULT [];\n"),
      ).toEqual([]);
      expect(rules("-- +goose Up\nALTER TABLE t ADD COLUMN `Count` UInt64;\n")).toEqual([]);
    });

    /** @scenario "More than one statement in a goose block is refused by name" */
    it("refuses two statements in one goose block, naming the count", () => {
      const findings = scan(
        "-- +goose Up\n-- +goose StatementBegin\nALTER TABLE t ADD COLUMN a UInt8;\n" +
          "ALTER TABLE t ADD COLUMN b UInt8;\n-- +goose StatementEnd\n",
      );
      expect(findings[0]?.rule).toBe("one-statement-per-goose-block");
      expect(findings[0]?.problem).toContain("2 statements");
      expect(findings[0]?.fix).toContain("multi-statement query");
    });

    /** @scenario "A down migration that is not commented out is refused by name" */
    it("refuses live SQL under -- +goose Down, and accepts it commented out", () => {
      const live =
        "-- +goose Up\nALTER TABLE t ADD COLUMN a UInt8;\n" +
        "-- +goose Down\nALTER TABLE t DROP COLUMN a;\n";
      expect(rules(live)).toContain("live-down-migration");
      const commented =
        "-- +goose Up\nALTER TABLE t ADD COLUMN a UInt8;\n" +
        "-- +goose Down\n-- To roll back, uncomment and run manually.\n" +
        "-- ALTER TABLE t DROP COLUMN a;\n";
      expect(rules(commented)).toEqual([]);
    });

    /** @scenario "Every finding carries its own fix" */
    it("names the rule, the migration, the problem and the fix on every finding", () => {
      const findings = scan("-- +goose Up\nALTER TABLE t RENAME COLUMN a TO b;\nDROP TABLE t;\n");
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(finding.migration).toBe("00999_fixture.sql");
        expect(finding.rule).not.toBe("");
        expect(finding.problem).not.toBe("");
        expect(finding.fix.length).toBeGreaterThan(40);
      }
    });
  });

  describe("the baseline", () => {
    it("exempts history that the rules would otherwise report", () => {
      const exempted = migrations.filter(
        (migration) =>
          baseline.includes(migration.name) && scanClickHouseMigration(migration).length > 0,
      );
      expect(exempted.length).toBeGreaterThan(0);
      expect(unshipped.map((migration) => migration.name)).not.toContain(exempted[0]?.name);
    });

    it("holds no entry written after the freeze", () => {
      expect(baseline.filter((name) => name > BASELINE_FROZEN_AT)).toEqual([]);
    });

    it("names only migrations that exist on disk", () => {
      const names = new Set(migrations.map((migration) => migration.name));
      expect(baseline.filter((name) => !names.has(name))).toEqual([]);
    });
  });
});
