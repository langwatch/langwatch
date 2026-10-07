import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FLOOR_AND_LOCK_RULES,
  type MigrationSource,
  formatFindings,
  parseBaseline,
  parseRelease,
  scanPostgresMigration,
} from "./migration-safety.rules.ts";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../prisma/migrations");
const FLOOR_FILE = resolve(import.meta.dirname, "../../../upgrade/releases/lts-floor.json");

/** The fixture floor the rule tests use, so they hold whatever the real floor becomes. */
const FIXTURE_FLOOR = "3.20.1";

/** The LTS floor in the tree; the fixture floor until `lts-floor.json` exists. */
const treeFloor: string = existsSync(FLOOR_FILE)
  ? (JSON.parse(readFileSync(FLOOR_FILE, "utf8")) as { release: string }).release
  : FIXTURE_FLOOR;

/**
 * The newest migration the baseline was recorded from. Prisma names sort by
 * timestamp, so anything written after the freeze sorts above this — which is
 * what makes "never extend the baseline" checkable. ADR-155.
 */
const BASELINE_FROZEN_AT = "20261006170505_project_active_day";

/**
 * The newest migration on disk when the floor and lock rules landed. Migrations up to it were
 * written before those rules existed and answer only to the four older ones; anything above
 * it answers to all. Like BASELINE_FROZEN_AT, it is never moved to silence a finding.
 */
const NEW_RULES_FROM = "20261006170527_data_privacy_project_scope";

const baseline = parseBaseline(
  readFileSync(resolve(import.meta.dirname, "migration-safety.baseline.txt"), "utf8"),
);

/** Name and recorded blob sha of each migration merged in from main. */
const fromMain = parseBaseline(
  readFileSync(resolve(import.meta.dirname, "migration-safety.from-main.txt"), "utf8"),
).map((line) => {
  const [name = "", blob = ""] = line.split(/\s+/);
  return { name, blob };
});

/** What `git hash-object` prints for this file: sha1 over "blob <size>\0" + its bytes. */
function gitBlobSha({ path }: { path: string }): string {
  const content = readFileSync(path);
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/** One migration folder, its `.sql` files concatenated in the order Prisma applies them. */
function readMigration(name: string): MigrationSource {
  const directory = resolve(MIGRATIONS_DIR, name);
  const sql = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .toSorted()
    .map((file) => readFileSync(resolve(directory, file), "utf8"))
    .join("\n");
  return { name, sql };
}

const migrations: MigrationSource[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => statSync(resolve(MIGRATIONS_DIR, name)).isDirectory())
  .toSorted()
  .map(readMigration);

const unshipped = migrations.filter(
  (migration) =>
    !baseline.includes(migration.name) && !fromMain.some((entry) => entry.name === migration.name),
);

/** What the tree scan reports for one migration, with the new rules only above their marker. */
function scanTree(migration: MigrationSource) {
  const findings = scanPostgresMigration({ ...migration, floor: treeFloor });
  return migration.name <= NEW_RULES_FROM
    ? findings.filter((finding) => !FLOOR_AND_LOCK_RULES.has(finding.rule))
    : findings;
}

const scanWith = (sql: string, floor: string) =>
  scanPostgresMigration({ name: "20991231000000_fixture", sql, floor });
const scan = (sql: string) => scanWith(sql, FIXTURE_FLOOR);
const rules = (sql: string) => scan(sql).map((finding) => finding.rule);

describe("Postgres migration safety", () => {
  it("leaves every migration newer than the baseline safe in both directions", () => {
    const findings = unshipped.flatMap(scanTree);
    expect(findings, `\n${formatFindings(findings)}\n`).toEqual([]);
  });

  describe("when the rules scan a migration", () => {
    /** @scenario "Dropping a column without a retirement note is refused by name" */
    it("refuses a drop with no retirement note, naming the column", () => {
      const findings = scan('ALTER TABLE "Project" DROP COLUMN "legacyKey";');
      expect(findings[0]?.rule).toBe("drop-without-retirement-note");
      expect(findings[0]?.problem).toContain("legacyKey");
      expect(findings[0]?.fix).toContain("must still find its schema");
    });

    /** @scenario "A drop retired a release earlier is accepted" */
    it("accepts a drop carrying a retirement note above it", () => {
      expect(
        rules('-- contract: retired in 1.42.0\nALTER TABLE "Project" DROP COLUMN "legacyKey";'),
      ).toEqual([]);
      expect(
        rules('ALTER TABLE "Project" DROP COLUMN "legacyKey";\n-- contract: retired in 1.42.0'),
      ).toEqual(["drop-without-retirement-note"]);
    });

    /** @scenario "A new NOT NULL column without a default is refused by name" */
    it("refuses a NOT NULL column with no DEFAULT, naming the column", () => {
      const findings = scan('ALTER TABLE "Project" ADD COLUMN "slug" TEXT NOT NULL;');
      expect(findings[0]?.rule).toBe("add-not-null-column-without-default");
      expect(findings[0]?.problem).toContain("slug");
      expect(findings[0]?.fix).toContain("does not name this column");
    });

    /** @scenario "A new NOT NULL column with a default is accepted" */
    it("accepts a NOT NULL column carrying a DEFAULT, and a nullable one", () => {
      expect(rules('ALTER TABLE "P" ADD COLUMN "slug" TEXT NOT NULL DEFAULT \'\';')).toEqual([]);
      expect(rules('ALTER TABLE "P" ADD COLUMN "slug" TEXT;')).toEqual([]);
    });

    /** @scenario "Setting NOT NULL on an existing table is refused by name" */
    it("refuses SET NOT NULL on an existing table, even with a backfill beside it", () => {
      const findings = scan('ALTER TABLE "P" ALTER COLUMN "slug" SET NOT NULL;');
      expect(findings[0]?.rule).toBe("set-not-null-on-populated-column");
      expect(findings[0]?.problem).toContain("slug");
      expect(findings[0]?.fix).toContain("NOT VALID");
      expect(
        rules(
          'UPDATE "P" SET "slug" = "id" WHERE "slug" IS NULL;\n' +
            'ALTER TABLE "P" ALTER COLUMN "slug" SET NOT NULL;',
        ),
      ).toEqual(["set-not-null-on-populated-column"]);
    });

    /** @scenario "Setting NOT NULL on a table the migration creates is accepted" */
    it("accepts SET NOT NULL on a table created in the same migration", () => {
      expect(
        rules('CREATE TABLE "N" ("id" TEXT);\nALTER TABLE "N" ALTER COLUMN "id" SET NOT NULL;'),
      ).toEqual([]);
    });

    /** @scenario "A retirement note above the LTS floor is refused by name" */
    it("refuses a drop whose note names a release above the floor, naming both", () => {
      const sql = '-- contract: retired in 3.21.0\nALTER TABLE "P" DROP COLUMN "old";';
      const findings = scan(sql);
      expect(findings.map((finding) => finding.rule)).toEqual(["retirement-note-above-floor"]);
      expect(findings[0]?.problem).toContain("3.21.0");
      expect(findings[0]?.problem).toContain(FIXTURE_FLOOR);
      expect(findings[0]?.fix).toContain("lts-floor.json names 3.21.0 or later");
      expect(rules('-- contract: retired in soon\nDROP TABLE "T";')).toEqual([
        "retirement-note-above-floor",
      ]);
    });

    /** @scenario "A retirement note at or below the LTS floor is accepted" */
    it("accepts a drop whose note names the floor itself or an older release", () => {
      const drop = 'ALTER TABLE "P" DROP COLUMN "old";';
      expect(rules(`-- contract: retired in 3.20.1\n${drop}`)).toEqual([]);
      expect(rules(`-- contract: retired in v3.19.9\n${drop}`)).toEqual([]);
      expect(rules(`-- contract: retired in 2.99.0\n${drop}`)).toEqual([]);
      expect(scanWith(`-- contract: retired in 3.21.0\n${drop}`, "3.21.0")).toEqual([]);
      expect(parseRelease("langwatch@v3.20.1")).toEqual([3, 20, 1]);
    });

    /** @scenario "Recreating or renaming an enum type is refused by name" */
    it("refuses an enum renamed to _old and recreated, naming the type", () => {
      const sql =
        'ALTER TYPE "Kind" RENAME TO "Kind_old";\n' +
        "CREATE TYPE \"Kind\" AS ENUM ('a');\n" +
        'ALTER TABLE "P" ALTER COLUMN "kind" TYPE "Kind" USING "kind"::text::"Kind";\n' +
        'DROP TYPE "Kind_old";';
      const found = rules(sql);
      expect(found).toContain("enum-recreated");
      expect(found).toContain("alter-column-type");
      expect(scan(sql).find((f) => f.rule === "enum-recreated")?.problem).toContain("Kind_old");
      expect(rules('DROP TYPE "K";\nCREATE TYPE "K" AS ENUM (\'a\');')).toContain("enum-recreated");
    });

    /** @scenario "Adding an enum value is accepted" */
    it("accepts a new enum and a new value on an existing one", () => {
      expect(rules("CREATE TYPE \"Kind\" AS ENUM ('a');")).toEqual([]);
      expect(rules("ALTER TYPE \"Kind\" ADD VALUE IF NOT EXISTS 'b';")).toEqual([]);
    });

    /** @scenario "A unique index or validated constraint on an existing table is refused by name" */
    it("refuses a unique index, a UNIQUE constraint and a validated CHECK on an existing table", () => {
      const unique = scan('CREATE UNIQUE INDEX "P_slug_key" ON "P"("slug");');
      expect(unique[0]?.rule).toBe("unique-or-validated-constraint-on-existing-table");
      expect(unique[0]?.problem).toContain("P_slug_key");
      for (const sql of [
        'ALTER TABLE "P" ADD CONSTRAINT "P_slug_key" UNIQUE ("slug");',
        'ALTER TABLE "P" ADD CONSTRAINT "P_ok" CHECK ("n" > 0);',
        'ALTER TABLE "P" ADD CONSTRAINT "P_t" FOREIGN KEY ("t") REFERENCES "T"("id");',
      ]) {
        expect(rules(sql)).toEqual(["unique-or-validated-constraint-on-existing-table"]);
      }
    });

    /** @scenario "A constraint added NOT VALID, or attached from a prebuilt index, is accepted" */
    it("accepts NOT VALID, USING INDEX, and anything on a table the migration creates", () => {
      expect(rules('ALTER TABLE "P" ADD CONSTRAINT "c" CHECK ("n" > 0) NOT VALID;')).toEqual([]);
      expect(rules('ALTER TABLE "P" ADD CONSTRAINT "u" UNIQUE USING INDEX "P_slug_key";')).toEqual(
        [],
      );
      expect(
        rules(
          'CREATE TABLE "N" ("id" TEXT NOT NULL);\n' +
            'CREATE UNIQUE INDEX "N_id_key" ON "N"("id");\n' +
            'CREATE INDEX "N_id_idx" ON "N"("id");',
        ),
      ).toEqual([]);
    });

    /** @scenario "A plain index on an existing table without the ops pre-build note is refused" */
    it("refuses a plain index on an existing table, naming the index and the note", () => {
      const findings = scan('CREATE INDEX "P_slug_idx" ON "P"("slug");');
      expect(findings[0]?.rule).toBe("plain-index-on-existing-table");
      expect(findings[0]?.problem).toContain("P_slug_idx");
      expect(findings[0]?.fix).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    });

    /** @scenario "A plain index carrying the ops pre-build note is accepted" */
    it("accepts the ops pre-build note, and the migration that already ships one", () => {
      const note =
        "-- Build ahead of the release, outside Prisma's transaction:\n" +
        '--   CREATE INDEX CONCURRENTLY IF NOT EXISTS\n--     "P_slug_idx" ON "P" ("slug");\n';
      expect(rules(`${note}CREATE INDEX IF NOT EXISTS "P_slug_idx" ON "P"("slug");`)).toEqual([]);
      expect(rules(`${note}CREATE INDEX IF NOT EXISTS "Q_other_idx" ON "Q"("slug");`)).toEqual([
        "plain-index-on-existing-table",
      ]);
      const shipped = readMigration("20261006120000_process_outbox_lease_by_process_index");
      expect(scanPostgresMigration({ ...shipped, floor: FIXTURE_FLOOR })).toEqual([]);
    });

    /** @scenario "Changing a column type in place is refused by name" */
    it("refuses ALTER COLUMN TYPE, naming the column and the new type", () => {
      const findings = scan('ALTER TABLE "P" ALTER COLUMN "n" SET DATA TYPE BIGINT;');
      expect(findings[0]?.rule).toBe("alter-column-type");
      expect(findings[0]?.problem).toContain("p.n");
      expect(findings[0]?.problem).toContain("BIGINT");
      expect(rules('ALTER TABLE "P" ALTER COLUMN "n" TYPE TEXT;')).toEqual(["alter-column-type"]);
    });

    /** @scenario "A well-formed additive migration is accepted" */
    it("accepts a new table with its indexes and a nullable or defaulted column", () => {
      expect(
        rules(
          'CREATE TABLE "S" ("id" TEXT NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n' +
            ' CONSTRAINT "S_pkey" PRIMARY KEY ("id"));\n' +
            'CREATE INDEX "S_at_idx" ON "S"("at");\n' +
            'ALTER TABLE "P" ADD COLUMN IF NOT EXISTS "note" TEXT;\n' +
            'ALTER TABLE "P" ADD COLUMN IF NOT EXISTS "n" INTEGER NOT NULL DEFAULT 0;',
        ),
      ).toEqual([]);
      const privacy = readMigration("20261006170527_data_privacy_project_scope");
      expect(scanPostgresMigration({ ...privacy, floor: FIXTURE_FLOOR })).toEqual([]);
    });

    /** @scenario "Renaming a column or a table in place is refused by name" */
    it("refuses a column rename and a table rename, naming both names", () => {
      const column = scan('ALTER TABLE "P" RENAME COLUMN "old" TO "new";');
      expect(column[0]?.rule).toBe("rename-in-place");
      expect(column[0]?.problem).toContain("old");
      expect(column[0]?.problem).toContain("new");
      expect(column[0]?.fix).toContain("way back");
      expect(rules('ALTER TABLE "Project" RENAME TO "Workspace";')).toEqual(["rename-in-place"]);
    });

    /** @scenario "Renaming an index or a constraint is accepted" */
    it("accepts an index or constraint rename, which no code reads by name", () => {
      expect(rules('ALTER INDEX "P_slug_key" RENAME TO "P_slug_unique";')).toEqual([]);
      expect(rules('ALTER TABLE "P" RENAME CONSTRAINT "P_pkey" TO "Project_pkey";')).toEqual([]);
    });
  });

  describe("given the baseline of shipped migrations", () => {
    /** @scenario "Migrations already shipped are not scanned" */
    it("exempts history that the rules would otherwise report", () => {
      const exempted = migrations.filter(
        (migration) => baseline.includes(migration.name) && scanTree(migration).length > 0,
      );
      expect(exempted.length).toBeGreaterThan(0);
      expect(unshipped.map((migration) => migration.name)).not.toContain(exempted[0]?.name);
    });

    /** @scenario "The baseline cannot be extended to silence a new finding" */
    it("holds no entry written after the freeze", () => {
      expect(baseline.filter((name) => name > BASELINE_FROZEN_AT)).toEqual([]);
    });

    /** @scenario "The freeze marker names a migration on disk" */
    it("freezes at a migration that exists, so a renumber cannot move it silently", () => {
      expect(migrations.map((migration) => migration.name)).toContain(BASELINE_FROZEN_AT);
    });

    /** @scenario "The floor and lock rules start above a marker that names a migration on disk" */
    it("starts the floor and lock rules at a migration that exists and is not baselined", () => {
      const names = migrations.map((migration) => migration.name);
      expect(names).toContain(NEW_RULES_FROM);
      expect(baseline).not.toContain(NEW_RULES_FROM);
      expect(NEW_RULES_FROM > BASELINE_FROZEN_AT).toBe(true);
    });

    /** @scenario "Every baselined name still names a migration on disk" */
    it("names only migrations that exist on disk", () => {
      const names = new Set(migrations.map((migration) => migration.name));
      expect(baseline.filter((name) => !names.has(name))).toEqual([]);
    });
  });

  describe("given the migrations merged in from main", () => {
    /** @scenario "A migration merged in from main is skipped only while it matches main's bytes" */
    it("skips each listed migration and holds it to the blob sha main ships", () => {
      expect(fromMain.length).toBeGreaterThan(0);
      const drifted = fromMain.filter(
        (entry) =>
          gitBlobSha({ path: resolve(MIGRATIONS_DIR, entry.name, "migration.sql") }) !== entry.blob,
      );
      expect(drifted.map((entry) => entry.name)).toEqual([]);
      const skipped = new Set(fromMain.map((entry) => entry.name));
      expect(unshipped.filter((migration) => skipped.has(migration.name))).toEqual([]);
    });
  });
});
