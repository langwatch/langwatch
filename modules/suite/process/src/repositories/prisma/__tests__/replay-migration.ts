/**
 * Reads a shipped migration back, so a test runs the SQL that shipped instead of a copy of
 * it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../../packages/prisma-client/prisma/migrations",
);

/**
 * A migration runs before the Prisma client and its multitenancy middleware
 * exist, and it works on every project at once. The guard on raw queries has
 * to be told that, and this is the comment it reads.
 */
const TENANCY_OPTOUT = "-- @tenancy: a data migration, which runs over every project by design\n";

/** Names a pre-`20260828120001` statement uses, and their names today. */
const VOCABULARY_RENAMES: [RegExp, string][] = [
  [/"folderId"/g, '"testSuiteId"'],
  [/'folder'/g, "'test_suite'"],
  [/'custom'/g, "'run_plan'"],
];

function migrationPath(nameSuffix: string): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(nameSuffix));
  if (matches.length !== 1) {
    throw new Error(
      `Expected one "${nameSuffix}" migration, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, matches[0]!, "migration.sql");
}

/**
 * The statements of one migration, comments stripped, the vocabulary carried forward and
 * the tenancy opt-out added.
 */
export function migrationStatements({
  nameSuffix,
  carryVocabularyForward = true,
}: {
  nameSuffix: string;
  /**
   * False for the vocabulary migration itself, whose statements read the
   * old names on purpose and must reach the database as they were written.
   */
  carryVocabularyForward?: boolean;
}): string[] {
  let sql = readFileSync(migrationPath(nameSuffix), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  if (carryVocabularyForward) {
    for (const [pattern, replacement] of VOCABULARY_RENAMES) {
      sql = sql.replace(pattern, replacement);
    }
  }
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${TENANCY_OPTOUT}${statement}`);
}
