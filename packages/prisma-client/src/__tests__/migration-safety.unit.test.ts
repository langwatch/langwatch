import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type MigrationSource,
  formatFindings,
  parseBaseline,
  scanPostgresMigration,
} from "./migration-safety.rules.ts";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../prisma/migrations");

/**
 * The newest migration the baseline was recorded from. Prisma names sort by
 * timestamp, so anything written after the freeze sorts above this — which is
 * what makes "never extend the baseline" checkable. ADR-155.
 */
const BASELINE_FROZEN_AT = "20260923160000_project_active_day";

const baseline = parseBaseline(
  readFileSync(resolve(import.meta.dirname, "migration-safety.baseline.txt"), "utf8"),
);

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

const unshipped = migrations.filter((migration) => !baseline.includes(migration.name));

const scan = (sql: string) => scanPostgresMigration({ name: "20991231000000_fixture", sql });
const rules = (sql: string) => scan(sql).map((finding) => finding.rule);

describe("Postgres migration safety", () => {
  it("leaves every migration newer than the baseline safe in both directions", () => {
    const findings = unshipped.flatMap(scanPostgresMigration);
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

    /** @scenario "Setting NOT NULL without a backfill beside it is refused by name" */
    it("refuses SET NOT NULL with no UPDATE filling the column first", () => {
      const findings = scan('ALTER TABLE "P" ALTER COLUMN "slug" SET NOT NULL;');
      expect(findings[0]?.rule).toBe("set-not-null-without-backfill");
      expect(findings[0]?.problem).toContain("slug");
      expect(
        rules(
          'UPDATE "P" SET "slug" = "id" WHERE "slug" IS NULL;\n' +
            'ALTER TABLE "P" ALTER COLUMN "slug" SET NOT NULL;',
        ),
      ).toEqual([]);
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
        (migration) =>
          baseline.includes(migration.name) && scanPostgresMigration(migration).length > 0,
      );
      expect(exempted.length).toBeGreaterThan(0);
      expect(unshipped.map((migration) => migration.name)).not.toContain(exempted[0]?.name);
    });

    /** @scenario "The baseline cannot be extended to silence a new finding" */
    it("holds no entry written after the freeze", () => {
      expect(baseline.filter((name) => name > BASELINE_FROZEN_AT)).toEqual([]);
    });

    /** @scenario "Every baselined name still names a migration on disk" */
    it("names only migrations that exist on disk", () => {
      const names = new Set(migrations.map((migration) => migration.name));
      expect(baseline.filter((name) => !names.has(name))).toEqual([]);
    });
  });
});
