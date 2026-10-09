import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const MIGRATION_FILE = join(
  repositoryRoot,
  "packages/prisma-client/prisma/migrations/20261009160010_dashboard_scope/migration.sql",
);

const TYPE_GUARD = /DO \$\$[\s\S]*?END \$\$;/;
const folded = (sql: string) => sql.replace(/\s+/g, " ").trim();

/**
 * The scope migration exactly as shipped, comments dropped and whitespace folded, so a test
 * fails when the file is edited out from under what it promises: the guard that creates the
 * type, then every statement after it.
 */
export function dashboardScopeMigration(): { typeGuard: string; statements: string[] } {
  const sql = readFileSync(MIGRATION_FILE, "utf8").replace(/^\s*--.*$/gm, "");
  const typeGuard = TYPE_GUARD.exec(sql)?.[0] ?? "";
  const statements = sql
    .replace(TYPE_GUARD, "")
    .split(";")
    .map(folded)
    .filter((statement) => statement !== "");
  return { typeGuard: folded(typeGuard), statements };
}
