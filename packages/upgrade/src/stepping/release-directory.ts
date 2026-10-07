import { cp, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { SteppingError } from "./stepping.errors.ts";

/** The lock file Prisma checks the provider against; a different provider is refused (P3019). */
export const MIGRATION_LOCK = 'provider = "postgresql"\n';

/**
 * Writes a fresh Prisma migrations directory holding every folder up to and including a release,
 * plus `migration_lock.toml`, and returns its path. Refuses a repeated folder name or a folder
 * without `migration.sql` before anything is written.
 */
export async function writeReleaseDirectory({
  folders,
}: {
  folders: readonly string[];
}): Promise<string> {
  const names = new Set<string>();
  for (const folder of folders) {
    const name = basename(folder);
    if (names.has(name)) {
      throw new SteppingError({
        code: "duplicate_folder",
        message: `The Prisma folder ${name} is listed twice.`,
      });
    }
    names.add(name);
    const sql = await stat(join(folder, "migration.sql")).catch(() => null);
    if (!sql?.isFile()) {
      throw new SteppingError({
        code: "missing_migration_sql",
        message: `The Prisma folder ${name} has no migration.sql.`,
      });
    }
  }
  const root = await mkdtemp(join(tmpdir(), "langwatch-stepping-"));
  const migrations = join(root, "migrations");
  await mkdir(migrations);
  await Promise.all(
    folders.map((folder) => cp(folder, join(migrations, basename(folder)), { recursive: true })),
  );
  await writeFile(join(migrations, "migration_lock.toml"), MIGRATION_LOCK);
  return root;
}
