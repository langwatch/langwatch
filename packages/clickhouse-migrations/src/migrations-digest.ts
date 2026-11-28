import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../migrations");

/** The code that rewrites or adds to what the SQL files say: placeholders, TTLs, the task. */
const SCHEMA_SOURCES = [
  "goose.migration-runner.ts",
  "ttl.reconciler.ts",
  "clickhouse-migrate.task.ts",
].map((name) => path.join(import.meta.dirname, name));

/**
 * A short digest of every migration file's name and content and of the code that shapes the
 * schema they build, so a schema built from them can be named by what it holds and rebuilt
 * when any of them changes.
 */
export function shippedMigrationsDigest({
  migrationsDir = MIGRATIONS_DIR,
  sourceFiles = SCHEMA_SOURCES,
}: { migrationsDir?: string; sourceFiles?: readonly string[] } = {}): string {
  const hash = createHash("sha256");
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ label: name, file: path.join(migrationsDir, name) }));
  const sources = sourceFiles.map((file) => ({ label: `source:${path.basename(file)}`, file }));
  for (const { label, file } of [...migrations, ...sources]) {
    hash.update(label).update("\0").update(readFileSync(file)).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
