import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  lintRerunnableMigrationsAt,
  RERUNNABLE_MARKER_FILE,
  splitStatements,
} from "../src/policies/persistence/rerunnable-migrations.ts";

/**
 * @see packages/architecture-enforcer/specs/rerunnable-migrations.feature
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(here, "..", "..", "..");
const MIGRATIONS = "packages/prisma-client/prisma/migrations";
const MARKER = "20261001000000_marker";
const NEWER = "20261002000000_newer";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ marker = MARKER }: { marker?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rerunnable-migrations-"));
  roots.push(root);
  const write = (path: string, source: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  write(RERUNNABLE_MARKER_FILE, `export const RERUNNABLE_PRISMA_FROM = "${marker}";\n`);
  write(`${MIGRATIONS}/${MARKER}/migration.sql`, 'CREATE TABLE "Old" ("id" TEXT);\n');
  return {
    root,
    migration(name: string, sql: string) {
      write(`${MIGRATIONS}/${name}/migration.sql`, sql);
    },
    lint: () => lintRerunnableMigrationsAt({ root }),
  };
}

const messages = (violations: { message: string }[]) => violations.map((each) => each.message);

describe("rerunnable-migrations", () => {
  /** @scenario "Guarded forms of every statement pass" */
  it("passes every guarded form", () => {
    const tree = fixture();
    tree.migration(
      NEWER,
      `CREATE TABLE IF NOT EXISTS "Note" ("id" TEXT PRIMARY KEY);
CREATE UNIQUE INDEX IF NOT EXISTS "Note_id_key" ON "Note"("id");
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "body" TEXT, ALTER COLUMN "body" SET DEFAULT '';
ALTER TABLE "Note" DROP COLUMN IF EXISTS "legacy";
ALTER TYPE "Kind" ADD VALUE IF NOT EXISTS 'NEW';
DROP INDEX IF EXISTS "Note_old_idx";
CREATE OR REPLACE VIEW "NoteView" AS SELECT 1;
INSERT INTO "Note" ("id") VALUES ('a') ON CONFLICT DO NOTHING;
UPDATE "Note" SET "body" = '' WHERE "body" IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Note_body_check') THEN
    ALTER TABLE "Note" ADD CONSTRAINT "Note_body_check" CHECK ("body" <> 'x');
  END IF;
END $$;
`,
    );
    expect(tree.lint()).toEqual([]);
  });

  /** @scenario "A bare CREATE TABLE, CREATE INDEX or ADD COLUMN is refused naming the statement" */
  it("refuses a bare CREATE TABLE, CREATE INDEX and ADD COLUMN, each by line", () => {
    const tree = fixture();
    tree.migration(
      NEWER,
      `CREATE TABLE "Note" ("id" TEXT);
CREATE INDEX "Note_idx" ON "Note"("id");
ALTER TABLE "Note" ADD COLUMN "body" TEXT;
`,
    );
    const violations = tree.lint();
    expect(violations.map((each) => [each.policy, each.line])).toEqual([
      ["rerunnable-migrations", 1],
      ["rerunnable-migrations", 2],
      ["rerunnable-migrations", 3],
    ]);
    expect(messages(violations)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS"),
      expect.stringContaining("CREATE INDEX IF NOT EXISTS"),
      expect.stringContaining("ADD COLUMN IF NOT EXISTS"),
    ]);
    expect(violations[0]?.file).toBe(join(tree.root, MIGRATIONS, NEWER, "migration.sql"));
  });

  /** @scenario "A constraint, a rename or a bare INSERT is refused with the DO-block or ON CONFLICT fix" */
  it("refuses a constraint, a rename and a bare INSERT with their fixes", () => {
    const tree = fixture();
    tree.migration(
      NEWER,
      `ALTER TABLE "Note" ADD CONSTRAINT "Note_pkey" PRIMARY KEY ("id");
ALTER TABLE "Note" RENAME COLUMN "body" TO "text";
INSERT INTO "Note" ("id") VALUES ('a');
`,
    );
    expect(messages(tree.lint())).toEqual([
      expect.stringContaining("DO $$"),
      expect.stringContaining("DO $$"),
      expect.stringContaining("ON CONFLICT"),
    ]);
  });

  /** @scenario "A concurrent index build is refused" */
  it("refuses CREATE INDEX CONCURRENTLY even with IF NOT EXISTS", () => {
    const tree = fixture();
    tree.migration(NEWER, `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Note_idx" ON "Note"("id");`);
    expect(messages(tree.lint())).toEqual([expect.stringContaining("INVALID index")]);
  });

  /** @scenario "A statement the policy does not recognise is refused" */
  it("refuses an unguarded CREATE POLICY and an unknown statement", () => {
    const tree = fixture();
    tree.migration(
      NEWER,
      `CREATE POLICY "own" ON "Note" USING (true);\nCLUSTER "Note" USING "Note_idx";\n`,
    );
    expect(messages(tree.lint())).toEqual([
      expect.stringContaining("CREATE OR REPLACE"),
      expect.stringContaining("not known to be re-runnable"),
    ]);
  });

  /** @scenario "Semicolons inside strings, comments and dollar-quoted bodies do not split a statement" */
  it("keeps semicolons in strings, comments and dollar-quoted bodies inside their statement", () => {
    const sql = `-- a comment; with a semicolon
/* block; comment */ UPDATE "Note" SET "body" = 'a;b' WHERE "id" = 'x';
DO $guard$ BEGIN PERFORM 1; PERFORM 2; END $guard$;
SELECT "a;b" FROM "Note";`;
    expect(splitStatements(sql).map((each) => each.line)).toEqual([2, 3, 4]);
    expect(splitStatements(sql)[1]?.text).toBe(
      "DO $guard$ BEGIN PERFORM 1; PERFORM 2; END $guard$",
    );
    const tree = fixture();
    tree.migration(NEWER, sql);
    expect(tree.lint()).toEqual([]);
  });

  /** @scenario "Migrations at or below the marker are not read" */
  it("does not read the marker's own folder or older ones", () => {
    const tree = fixture();
    tree.migration("20260901000000_older", 'CREATE TABLE "Older" ("id" TEXT);');
    expect(tree.lint()).toEqual([]);
  });

  /** @scenario "A marker that names no migration folder is refused" */
  it("refuses a marker naming a folder the tree does not hold", () => {
    const tree = fixture({ marker: "20261005000000_typo" });
    const violations = tree.lint();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(join(tree.root, RERUNNABLE_MARKER_FILE));
    expect(violations[0]?.message).toContain("20261005000000_typo");
  });

  /** @scenario "Today's tree holds no finding" */
  it("finds nothing in the repository's own migrations", () => {
    expect(lintRerunnableMigrationsAt({ root: REPOSITORY_ROOT })).toEqual([]);
  });
});
