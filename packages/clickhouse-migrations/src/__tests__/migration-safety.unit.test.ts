import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRACEFUL_RULES,
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

/** The newest goose file in the newest `langwatch@v*` tag: history the graceful rules skip. */
function newestReleasedMigration({ cwd }: { cwd: string }): string {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // A release tag lists every file it holds: about 2 MB today.
      maxBuffer: 64 * 1024 * 1024,
    });
  let cause: unknown;
  try {
    const tag = git(["tag", "--list", "langwatch@v*", "--sort=-v:refname"])
      .split("\n")
      .find((name) => /^langwatch@v\d+\.\d+\.\d+$/.test(name));
    const paths = tag ? git(["ls-tree", "-r", "--full-tree", "--name-only", tag]) : "";
    const newest = paths
      .split("\n")
      .flatMap((path) => /clickhouse[^/]*\/migrations\/(\d{5}_[^/]+\.sql)$/.exec(path)?.[1] ?? [])
      .toSorted()
      .at(-1);
    if (newest) return newest;
  } catch (error) {
    // Not a clone, or git is missing: the same answer as a clone without tags, cause kept.
    cause = error;
  }
  throw new Error(
    "No langwatch@v* release tag with goose files in this clone, so released migrations " +
      "cannot be told from new ones. Fetch the tags: git fetch --tags origin (CI: " +
      "git fetch --depth=1 origin '+refs/tags/langwatch@v*:refs/tags/langwatch@v*').",
    { cause },
  );
}

const RELEASED_THROUGH = newestReleasedMigration({ cwd: import.meta.dirname });

/** The code-step ids a `-- background step:` note may name. */
const STEPS: ReadonlySet<string> = new Set(
  (
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../upgrade/releases/image/code-steps.json"),
        "utf8",
      ),
    ) as { id: string }[]
  ).map((step) => step.id),
);

const baseline = parseBaseline(
  readFileSync(resolve(import.meta.dirname, "migration-safety.baseline.txt"), "utf8"),
);

const migrations: MigrationSource[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .toSorted()
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8") }));

const unshipped = migrations.filter((migration) => !baseline.includes(migration.name));

/** What the tree scan reports for one file, with the graceful rules only above the floor. */
function scanTree(migration: MigrationSource) {
  return scanClickHouseMigration({ ...migration, floor: treeFloor, steps: STEPS }).filter(
    (finding) => migration.name > RELEASED_THROUGH || !GRACEFUL_RULES.has(finding.rule),
  );
}

const FIXTURE_STEPS: ReadonlySet<string> = new Set(["trace:track-index"]);
const scanWith = (sql: string, floor: string) =>
  scanClickHouseMigration({ name: "00999_fixture.sql", sql, floor, steps: FIXTURE_STEPS });
const scan = (sql: string) => scanWith(sql, FIXTURE_FLOOR);
const rules = (sql: string) => scan(sql).map((finding) => finding.rule);

describe("ClickHouse migration safety", () => {
  it("leaves every migration newer than the baseline safe in both directions", () => {
    const findings = unshipped.flatMap(scanTree);
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
            "-- background step: trace:track-index\nALTER TABLE t MATERIALIZE INDEX idx;\n" +
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

  describe("given the graceful rules", () => {
    /** @scenario "A ClickHouse mutation at deploy is refused unless a background step tracks it" */
    it("refuses UPDATE, DELETE, MATERIALIZE COLUMN and MATERIALIZE INDEX with no step note", () => {
      const findings = scan(
        "-- +goose Up\nALTER TABLE ${D}.spans UPDATE `Cost` = 0 WHERE `Cost` IS NULL;\n",
      );
      expect(findings.map((finding) => finding.rule)).toEqual(["untracked-mutation"]);
      expect(findings[0]?.problem).toBe("runs UPDATE on ${D}.spans at deploy");
      expect(findings[0]?.fix).toContain("-- background step: <id>");
      for (const statement of [
        "ALTER TABLE t DELETE WHERE a = 1;",
        "DELETE FROM t WHERE a = 1;",
        "ALTER TABLE t MATERIALIZE COLUMN a;",
        "ALTER TABLE t MATERIALIZE INDEX idx;",
      ]) {
        expect(rules(`-- +goose Up\n${statement}\n`)).toEqual(["untracked-mutation"]);
      }
    });

    /** @scenario "A mutation under a note naming its background step is accepted" */
    it("accepts a mutation whose note names a known step, and refuses an unknown one", () => {
      expect(
        rules(
          "-- +goose Up\n-- background step: trace:track-index\nALTER TABLE t MATERIALIZE INDEX idx;\n",
        ),
      ).toEqual([]);
      const unknown = scan(
        "-- +goose Up\n-- background step: trace:nope\nALTER TABLE t MATERIALIZE COLUMN a;\n",
      );
      expect(unknown.map((finding) => finding.rule)).toEqual(["unknown-background-step"]);
      expect(unknown[0]?.problem).toContain("trace:nope");
      expect(
        rules(
          "-- +goose Up\n-- background step: trace:track-index\nALTER TABLE t ADD COLUMN IF NOT EXISTS a UInt8;\n" +
            "ALTER TABLE t MATERIALIZE COLUMN a;\n",
        ),
      ).toEqual(["untracked-mutation"]);
    });

    /** @scenario "MODIFY TTL is refused unless it skips materialising" */
    it("refuses MODIFY TTL without materialize_ttl_after_modify = 0, and accepts it with", () => {
      const findings = scan("-- +goose Up\nALTER TABLE t MODIFY TTL At + INTERVAL 30 DAY;\n");
      expect(findings.map((finding) => finding.rule)).toEqual(["untracked-mutation"]);
      expect(findings[0]?.fix).toContain("materialize_ttl_after_modify = 0");
      expect(
        rules(
          "-- +goose Up\nALTER TABLE t MODIFY TTL At + INTERVAL 30 DAY\n" +
            "SETTINGS materialize_ttl_after_modify = 0;\n",
        ),
      ).toEqual([]);
    });

    /** @scenario "MODIFY ORDER BY, OPTIMIZE FINAL and POPULATE are refused by name" */
    it("refuses a sort key change, OPTIMIZE ... FINAL and a populated view, naming each", () => {
      const order = scan(
        "-- +goose Up\nALTER TABLE t ADD COLUMN IF NOT EXISTS b UInt8, MODIFY ORDER BY (a, b);\n",
      );
      expect(order.map((finding) => finding.rule)).toEqual(["modify-order-by"]);
      expect(order[0]?.fix).toContain("new table");
      const optimize = scan("-- +goose Up\nOPTIMIZE TABLE ${D}.spans FINAL;\n");
      expect(optimize.map((finding) => finding.rule)).toEqual(["optimize-final"]);
      expect(optimize[0]?.problem).toContain("${D}.spans");
      const populate = scan(
        "-- +goose Up\nCREATE MATERIALIZED VIEW IF NOT EXISTS mv TO t POPULATE AS SELECT 1;\n",
      );
      expect(populate.map((finding) => finding.rule)).toEqual(["materialized-view-populate"]);
      expect(populate[0]?.fix).toContain("without POPULATE");
    });

    /** @scenario "ClickHouse floor history answers only to the older rules" */
    it("skips the graceful rules up to the newest release tag's newest file, which is on disk", () => {
      expect(migrations.map((migration) => migration.name)).toContain(RELEASED_THROUGH);
      const history = migrations.filter((migration) => migration.name <= RELEASED_THROUGH);
      const graceful = history.flatMap((migration) =>
        scanClickHouseMigration({ ...migration, floor: treeFloor, steps: STEPS }).filter(
          (finding) => GRACEFUL_RULES.has(finding.rule),
        ),
      );
      expect(graceful.length).toBeGreaterThan(0);
      expect(
        history.flatMap(scanTree).filter((finding) => GRACEFUL_RULES.has(finding.rule)),
      ).toEqual([]);
    });

    /** @scenario "A clone without release tags fails the guard with the command that fetches them" */
    it("refuses to guess the released history where no release tag is readable", () => {
      const bare = mkdtempSync(resolve(tmpdir(), "goose-safety-no-tags-"));
      try {
        expect(() => newestReleasedMigration({ cwd: bare })).toThrow(/git fetch --tags origin/);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe("given the baseline of shipped migrations", () => {
    it("exempts history that the rules would otherwise report", () => {
      const exempted = migrations.filter(
        (migration) => baseline.includes(migration.name) && scanTree(migration).length > 0,
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
