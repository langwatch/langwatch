import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FLOOR_AND_LOCK_RULES,
  GRACEFUL_RULES,
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
 * The newest migration on disk when the floor and lock rules landed; W-01's foreign-key rule
 * starts here too. Migrations up to it answer only to the four older rules; anything above
 * it answers to all. Like BASELINE_FROZEN_AT, it is never moved to silence a finding.
 */
const NEW_RULES_FROM = "20261006170527_data_privacy_project_scope";

/** The newest migration in the newest `langwatch@v*` tag: history the graceful rules skip. */
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
      .flatMap(
        (path) =>
          /(?:^|\/)prisma\/migrations\/(\d{14}_[^/]+)\/migration\.sql$/.exec(path)?.[1] ?? [],
      )
      .toSorted()
      .at(-1);
    if (newest) return newest;
  } catch (error) {
    // Not a clone, or git is missing: the same answer as a clone without tags, cause kept.
    cause = error;
  }
  throw new Error(
    "No langwatch@v* release tag with Prisma migrations in this clone, so released migrations " +
      "cannot be told from new ones. Fetch the tags: git fetch --tags origin (CI: " +
      "git fetch --depth=1 origin '+refs/tags/langwatch@v*:refs/tags/langwatch@v*').",
    { cause },
  );
}

const RELEASED_THROUGH = newestReleasedMigration({ cwd: import.meta.dirname });

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
  return scanPostgresMigration({ ...migration, floor: treeFloor })
    .filter((finding) => migration.name > NEW_RULES_FROM || !FLOOR_AND_LOCK_RULES.has(finding.rule))
    .filter((finding) => migration.name > RELEASED_THROUGH || !GRACEFUL_RULES.has(finding.rule));
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
      ).toEqual(["set-not-null-on-populated-column", "inline-dml-on-existing-table"]);
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
            'ALTER TABLE "P" ADD COLUMN IF NOT EXISTS "note" TEXT,\n' +
            '  ADD COLUMN IF NOT EXISTS "n" INTEGER NOT NULL DEFAULT 0;',
        ),
      ).toEqual([]);
      const privacy = readMigration("20261006170527_data_privacy_project_scope");
      expect(scanPostgresMigration({ ...privacy, floor: FIXTURE_FLOOR })).toEqual([]);
    });

    /** @scenario "A new foreign key is refused by name" */
    it("refuses FOREIGN KEY and REFERENCES, on a new table or an existing one, naming the table", () => {
      const findings = scan(
        'ALTER TABLE "C" ADD CONSTRAINT "C_p_fkey" FOREIGN KEY ("p") REFERENCES "P"("id") NOT VALID;',
      );
      expect(findings.map((finding) => finding.rule)).toEqual(["new-foreign-key"]);
      expect(findings[0]?.problem).toBe("adds a foreign key on c");
      expect(findings[0]?.fix).toContain("plain column with an index");
      expect(rules('CREATE TABLE "N" ("id" TEXT, "p" TEXT REFERENCES "P"("id"));')).toEqual([
        "new-foreign-key",
      ]);
      expect(
        rules('ALTER TABLE "P" ADD CONSTRAINT "P_t" FOREIGN KEY ("t") REFERENCES "T"("id");'),
      ).toEqual(["new-foreign-key"]);
      expect(rules('-- the old FOREIGN KEY went\nALTER TABLE "P" ADD COLUMN "p" TEXT;')).toEqual(
        [],
      );
      expect(rules('COMMENT ON COLUMN "P"."t" IS \'references the team\';')).toEqual([]);
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

  describe("when the graceful rules scan a migration", () => {
    /** @scenario "An inline UPDATE or DELETE on an existing table is refused by name" */
    it("refuses UPDATE and DELETE on an existing table, naming it and the background step", () => {
      const findings = scan('UPDATE "P" AS p SET "slug" = "id" WHERE "slug" IS NULL;');
      expect(findings.map((finding) => finding.rule)).toEqual(["inline-dml-on-existing-table"]);
      expect(findings[0]?.problem).toContain("existing table p");
      expect(findings[0]?.fix).toContain("background step");
      expect(rules('DELETE FROM "P" WHERE "gone";')).toEqual(["inline-dml-on-existing-table"]);
    });

    /** @scenario "DML on a table the migration creates, or an upsert, is accepted" */
    it("accepts DML on a new table, ON CONFLICT DO UPDATE and ON DELETE clauses", () => {
      expect(
        rules('CREATE TABLE "N" ("id" TEXT);\nUPDATE "N" SET "id" = \'x\';\nDELETE FROM "N";'),
      ).toEqual([]);
      expect(
        rules(
          'INSERT INTO "N" ("id") VALUES (\'x\') ON CONFLICT ("id") DO UPDATE SET "id" = \'y\';',
        ),
      ).toEqual([]);
    });

    /** @scenario "A column added with a volatile default is refused by name" */
    it("refuses gen_random_uuid(), random() and SERIAL on an existing table, naming the column", () => {
      const findings = scan(
        'ALTER TABLE "P" ADD COLUMN "key" TEXT NOT NULL DEFAULT gen_random_uuid()::text;',
      );
      expect(findings.map((finding) => finding.rule)).toEqual([
        "volatile-default-on-existing-table",
      ]);
      expect(findings[0]?.problem).toContain("p.key");
      expect(findings[0]?.fix).toContain("rewrites the whole table");
      expect(rules('ALTER TABLE "P" ADD COLUMN "n" DOUBLE PRECISION DEFAULT random();')).toEqual([
        "volatile-default-on-existing-table",
      ]);
      expect(rules('ALTER TABLE "P" ADD COLUMN "seq" BIGSERIAL;')).toEqual([
        "volatile-default-on-existing-table",
      ]);
    });

    /** @scenario "A constant or stable default is accepted" */
    it("accepts a constant default, now() and CURRENT_TIMESTAMP, and anything on a new table", () => {
      expect(rules('ALTER TABLE "P" ADD COLUMN "at" TIMESTAMP(3) DEFAULT now();')).toEqual([]);
      expect(
        rules('ALTER TABLE "P" ADD COLUMN "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;'),
      ).toEqual([]);
      expect(
        rules(
          'CREATE TABLE "N" ("id" TEXT);\nALTER TABLE "N" ADD COLUMN "k" TEXT DEFAULT gen_random_uuid();',
        ),
      ).toEqual([]);
    });

    /** @scenario "Two ALTER statements on one existing table are refused by name" */
    it("refuses two ALTER TABLE statements on one existing table, naming it and the count", () => {
      const findings = scan(
        'ALTER TABLE "P" ADD COLUMN "a" TEXT;\nALTER TABLE "P" ADD COLUMN "b" TEXT;',
      );
      expect(findings.map((finding) => finding.rule)).toEqual(["several-alters-on-one-table"]);
      expect(findings[0]?.problem).toBe("alters existing table p in 2 statements");
      expect(findings[0]?.fix).toContain("separated by commas");
    });

    /** @scenario "One ALTER per existing table is accepted" */
    it("accepts one ALTER with several actions, and ALTERs on different or new tables", () => {
      expect(
        rules(
          'ALTER TABLE "P" ADD COLUMN "a" TEXT,\n  ADD COLUMN "b" TEXT;\n' +
            'ALTER TABLE "Q" ADD COLUMN "a" TEXT;\n' +
            'CREATE TABLE "N" ("id" TEXT);\nALTER TABLE "N" ADD COLUMN "a" TEXT;\n' +
            'ALTER TABLE "N" ADD COLUMN "b" TEXT;',
        ),
      ).toEqual([]);
    });

    /** @scenario "A lock_timeout above the runner's ceiling is refused by name" */
    it("refuses a lock_timeout above 2 s, or turned off, naming the value", () => {
      const findings = scan("SET lock_timeout = '10s';");
      expect(findings.map((finding) => finding.rule)).toEqual(["lock-timeout-above-ceiling"]);
      expect(findings[0]?.problem).toContain("10000 ms");
      expect(rules("SET LOCAL lock_timeout TO 0;")).toEqual(["lock-timeout-above-ceiling"]);
      expect(rules("SELECT set_config('lock_timeout', '1min', true);")).toEqual([
        "lock-timeout-above-ceiling",
      ]);
    });

    /** @scenario "A lock_timeout at or below the ceiling is accepted" */
    it("accepts a lock_timeout of 2 s or less", () => {
      expect(rules("SET lock_timeout = '2s';\nSET LOCAL lock_timeout = 500;")).toEqual([]);
    });
  });

  describe("given the released history", () => {
    /** @scenario "Floor history answers only to the older rules" */
    it("skips the graceful rules up to the newest release tag's newest migration, which is on disk", () => {
      expect(migrations.map((migration) => migration.name)).toContain(RELEASED_THROUGH);
      const history = migrations.filter((migration) => migration.name <= RELEASED_THROUGH);
      const graceful = history.flatMap((migration) =>
        scanPostgresMigration({ ...migration, floor: treeFloor }).filter((finding) =>
          GRACEFUL_RULES.has(finding.rule),
        ),
      );
      expect(graceful.length).toBeGreaterThan(0);
      expect(
        history.flatMap(scanTree).filter((finding) => GRACEFUL_RULES.has(finding.rule)),
      ).toEqual([]);
    });

    /** @scenario "A clone without release tags fails the guard with the command that fetches them" */
    it("refuses to guess the released history where no release tag is readable", () => {
      const bare = mkdtempSync(resolve(tmpdir(), "migration-safety-no-tags-"));
      try {
        expect(() => newestReleasedMigration({ cwd: bare })).toThrow(/git fetch --tags origin/);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
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
