import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../prisma/migrations",
);

/**
 * The down statement a Prisma migration documents under its
 * "-- Down, to roll back by hand:" heading, read from the migration itself so
 * a test runs what an operator would copy, not a retyped copy of it. Throws
 * when the migration no longer documents one.
 */
export function documentedDownPath({
  migration,
}: {
  migration: string;
}): string {
  const lines = fs
    .readFileSync(path.join(MIGRATIONS_DIR, migration, "migration.sql"), "utf8")
    .split("\n");
  const heading = lines.findIndex((line) =>
    line.startsWith("-- Down, to roll back by hand:"),
  );
  const statement = lines[heading + 1]?.replace(/^--\s+/, "").trim();
  if (heading < 0 || !statement?.startsWith("ALTER TABLE")) {
    throw new Error(`${migration} no longer documents its down path`);
  }
  return statement;
}
