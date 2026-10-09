import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type MigrationSource,
  formatFindings,
  parseBaseline,
  parseRelease,
  scanClickHouseMigration,
} from "./migration-safety.rules.ts";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");
const FLOOR_FILE = resolve(import.meta.dirname, "../../../upgrade/releases/lts-floor.json");

/** The fixture floor the rule tests use, so they hold whatever the real floor becomes. */
const FIXTURE_FLOOR = "3.20.1";

/** The LTS floor in the tree; the fixture floor until `lts-floor.json` exists. */
const treeFloor: string = existsSync(FLOOR_FILE)
  ? (JSON.parse(readFileSync(FLOOR_FILE, "utf8")) as { release: string }).release
  : FIXTURE_FLOOR;

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

const scanWith = (sql: string, floor: string) =>
  scanClickHouseMigration({ name: "00999_fixture.sql", sql, floor });
const scan = (sql: string) => scanWith(sql, FIXTURE_FLOOR);
const rules = (sql: string) => scan(sql).map((finding) => finding.rule);

describe("ClickHouse migration safety", () => {
  it("leaves every migration newer than the baseline safe in both directions", () => {
    const findings = unshipped.flatMap((migration) =>
      scanClickHouseMigration({ ...migration, floor: treeFloor }),
    );
    expect(findings, `\n${formatFindings(findings)}\n`).toEqual([]);
  });

  describe("given each rule scanned on its own", () => {
    /** @scenario "Dropping a ClickHouse column or table without a note is refused by name" */
    it("refuses a drop with no retirement note, naming the object", () => {
      const findings = scan(
        "-- +goose Up\nALTER TABLE ${D}.spans DROP COLUMN IF EXISTS `Legacy`;\n",
      );
      expect(findings[0]?.rule).toBe("drop-without-retirement-note");
      expect(findings[0]?.problem).toContain("Legacy");
      expect(
        rules("-- +goose Up\n-- contract: retired in 1.42.0\nDROP TABLE IF EXISTS old_spans;\n"),
      ).toEqual([]);
    });

    /** @scenario "Changing a ClickHouse column type without a note is refused by name" */
    it("refuses a type change, and says to add a column instead", () => {
      const findings = scan(
        "-- +goose Up\nALTER TABLE t MODIFY COLUMN IF EXISTS `Cost` Float64;\n",
      );
      expect(findings[0]?.rule).toBe("modify-column-type");
      expect(findings[0]?.problem).toContain("Cost");
      expect(findings[0]?.fix).toContain("switch the readers");
    });

    /** @scenario "A settings-only MODIFY COLUMN is accepted" */
    it("accepts a MODIFY COLUMN that only sets a TTL, CODEC or comment", () => {
      expect(
        rules("-- +goose Up\nALTER TABLE t MODIFY COLUMN IF EXISTS `Body` CODEC(ZSTD(3));\n"),
      ).toEqual([]);
      expect(
        rules(
          "-- +goose Up\nALTER TABLE t MODIFY COLUMN IF EXISTS `At` TTL At + INTERVAL 7 DAY;\n",
        ),
      ).toEqual([]);
    });

    /** @scenario "A variable-size column added without a default is refused by name" */
    it("refuses a variable-size column with no DEFAULT, and accepts one with it", () => {
      const findings = scan(
        "-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS `Tags` Array(String);\n",
      );
      expect(findings[0]?.rule).toBe("add-variable-size-column-without-default");
      expect(findings[0]?.problem).toContain("Tags");
      expect(
        rules(
          "-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS `Tags` Array(String) DEFAULT [];\n",
        ),
      ).toEqual([]);
      expect(
        rules("-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS `Count` UInt64;\n"),
      ).toEqual([]);
    });

    /** @scenario "More than one statement in a goose block is refused by name" */
    it("refuses two statements in one goose block, naming the count", () => {
      const findings = scan(
        "-- +goose Up\n-- +goose StatementBegin\nALTER TABLE t ADD COLUMN IF NOT EXISTS a UInt8;\n" +
          "ALTER TABLE t ADD COLUMN IF NOT EXISTS b UInt8;\n-- +goose StatementEnd\n",
      );
      expect(findings[0]?.rule).toBe("one-statement-per-goose-block");
      expect(findings[0]?.problem).toContain("2 statements");
      expect(findings[0]?.fix).toContain("multi-statement query");
    });

    /** @scenario "A down migration that is not commented out is refused by name" */
    it("refuses live SQL under -- +goose Down, and accepts it commented out", () => {
      const live =
        "-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS a UInt8;\n" +
        "-- +goose Down\nALTER TABLE t DROP COLUMN IF EXISTS a;\n";
      expect(rules(live)).toContain("live-down-migration");
      const commented =
        "-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS a UInt8;\n" +
        "-- +goose Down\n-- To roll back, uncomment and run manually.\n" +
        "-- ALTER TABLE t DROP COLUMN IF EXISTS a;\n";
      expect(rules(commented)).toEqual([]);
    });

    /** @scenario "A retirement note above the LTS floor is refused by name" */
    it("refuses a drop whose note names a release above the floor, naming both", () => {
      const findings = scan(
        "-- +goose Up\n-- contract: retired in 3.21.0\nDROP TABLE IF EXISTS old_spans;\n",
      );
      expect(findings.map((finding) => finding.rule)).toEqual(["retirement-note-above-floor"]);
      expect(findings[0]?.problem).toContain("3.21.0");
      expect(findings[0]?.problem).toContain(FIXTURE_FLOOR);
      expect(findings[0]?.fix).toContain("lts-floor.json names 3.21.0 or later");
      const typed = scan(
        "-- +goose Up\n-- contract: retired in 3.21.0\nALTER TABLE t MODIFY COLUMN IF EXISTS c Float64;\n",
      );
      expect(typed.map((finding) => finding.rule)).toEqual(["retirement-note-above-floor"]);
    });

    /** @scenario "A retirement note at or below the LTS floor is accepted" */
    it("accepts a note naming the floor itself or an older release", () => {
      const drop = "DROP TABLE IF EXISTS old_spans;";
      expect(rules(`-- +goose Up\n-- contract: retired in 3.20.1\n${drop}\n`)).toEqual([]);
      expect(rules(`-- +goose Up\n-- contract: retired in 2.0.0\n${drop}\n`)).toEqual([]);
      expect(scanWith(`-- +goose Up\n-- contract: retired in 3.21.0\n${drop}\n`, "3.21.0")).toEqual(
        [],
      );
      expect(parseRelease("v3.20.1")).toEqual([3, 20, 1]);
    });

    /** @scenario "DDL without IF EXISTS or IF NOT EXISTS is refused by name" */
    it("refuses CREATE, ADD, DROP and MODIFY without the guard, naming the object", () => {
      const created = scan("-- +goose Up\nCREATE TABLE ${D}.spans (a UInt8) ENGINE = Memory;\n");
      expect(created[0]?.rule).toBe("ddl-without-if-exists");
      expect(created[0]?.problem).toContain("${D}.spans");
      expect(created[0]?.fix).toContain("IF NOT EXISTS");
      const added = scan("-- +goose Up\nALTER TABLE t ADD COLUMN `Count` UInt64;\n");
      expect(added[0]?.problem).toContain("IF NOT EXISTS");
      expect(
        rules("-- +goose Up\nALTER TABLE t ADD INDEX idx a TYPE minmax GRANULARITY 1;\n"),
      ).toEqual(["ddl-without-if-exists"]);
      expect(
        rules("-- +goose Up\n-- contract: retired in 1.0.0\nALTER TABLE t DROP COLUMN `Old`;\n"),
      ).toEqual(["ddl-without-if-exists"]);
      expect(rules("-- +goose Up\nALTER TABLE t MODIFY COLUMN `Body` CODEC(ZSTD(3));\n")).toEqual([
        "ddl-without-if-exists",
      ]);
    });

    /** @scenario "Guarded DDL is accepted" */
    it("accepts IF NOT EXISTS, IF EXISTS, CREATE OR REPLACE and MATERIALIZE", () => {
      expect(
        rules(
          "-- +goose Up\nCREATE TABLE IF NOT EXISTS t (a UInt8) ENGINE = Memory;\n" +
            "ALTER TABLE t ADD INDEX IF NOT EXISTS idx a TYPE minmax GRANULARITY 1;\n" +
            "ALTER TABLE t MATERIALIZE INDEX idx;\n" +
            "CREATE OR REPLACE VIEW v AS SELECT 1;\n" +
            "CREATE MATERIALIZED VIEW IF NOT EXISTS mv TO t AS SELECT 1;\n",
        ),
      ).toEqual([]);
    });

    /** @scenario "A view dropped and created again, or modified in place, is refused by name" */
    it("refuses drop-then-create of one view and MODIFY QUERY, naming the view", () => {
      const findings = scan(
        "-- +goose Up\n-- contract: retired in 1.0.0\nDROP VIEW IF EXISTS ${D}.v;\n" +
          "CREATE VIEW IF NOT EXISTS ${D}.v AS SELECT 2;\n",
      );
      expect(findings.map((finding) => finding.rule)).toEqual(["view-replaced-in-place"]);
      expect(findings[0]?.problem).toContain("${D}.v");
      expect(findings[0]?.fix).toContain("under a new name");
      expect(rules("-- +goose Up\nALTER TABLE mv MODIFY QUERY SELECT 2;\n")).toEqual([
        "view-replaced-in-place",
      ]);
    });

    /** @scenario "A changed view under a new name is accepted" */
    it("accepts a new view beside the old one, and a view dropped without a replacement", () => {
      expect(
        rules(
          "-- +goose Up\nCREATE VIEW IF NOT EXISTS v_2 AS SELECT 2;\n" +
            "-- contract: retired in 1.0.0\nDROP VIEW IF EXISTS v_1;\n",
        ),
      ).toEqual([]);
    });

    /** @scenario "A well-formed additive migration is accepted" */
    it("accepts a guarded table and a defaulted column", () => {
      expect(
        rules(
          "-- +goose Up\n-- +goose StatementBegin\n" +
            "CREATE TABLE IF NOT EXISTS ${D}.s (a UInt8) ENGINE = MergeTree ORDER BY a;\n" +
            "-- +goose StatementEnd\n-- +goose StatementBegin\n" +
            "ALTER TABLE ${D}.s ADD COLUMN IF NOT EXISTS Tags Array(String) DEFAULT [];\n" +
            "-- +goose StatementEnd\n-- +goose Down\n-- To roll back, uncomment and run manually.\n" +
            "-- DROP TABLE ${D}.s;\n",
        ),
      ).toEqual([]);
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

  describe("given the baseline of shipped migrations", () => {
    it("exempts history that the rules would otherwise report", () => {
      const exempted = migrations.filter(
        (migration) =>
          baseline.includes(migration.name) &&
          scanClickHouseMigration({ ...migration, floor: treeFloor }).length > 0,
      );
      expect(exempted.length).toBeGreaterThan(0);
      expect(unshipped.map((migration) => migration.name)).not.toContain(exempted[0]?.name);
    });

    it("holds no entry written after the freeze", () => {
      expect(baseline.filter((name) => name > BASELINE_FROZEN_AT)).toEqual([]);
    });

    /** @scenario "The freeze marker names a migration on disk" */
    it("freezes at a migration that exists, so a renumber cannot move it silently", () => {
      expect(migrations.map((migration) => migration.name)).toContain(BASELINE_FROZEN_AT);
    });

    it("names only migrations that exist on disk", () => {
      const names = new Set(migrations.map((migration) => migration.name));
      expect(baseline.filter((name) => !names.has(name))).toEqual([]);
    });
  });
});
