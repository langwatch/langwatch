import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../migrations");

/**
 * A short digest of every migration file's name and content, so a schema built from them can be
 * named by what it holds and rebuilt when any file changes.
 */
export function shippedMigrationsDigest({
  migrationsDir = MIGRATIONS_DIR,
}: { migrationsDir?: string } = {}): string {
  const hash = createHash("sha256");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(migrationsDir, file)))
      .update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
