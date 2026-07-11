#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type MigrationSet = {
  name: string;
  directory: string;
  keyPattern: RegExp;
  keyFormat: string;
};

export const migrationSets: MigrationSet[] = [
  {
    name: "Prisma",
    directory: "langwatch/prisma/migrations",
    keyPattern: /^(\d{14})_/,
    keyFormat: "YYYYMMDDHHMMSS_name",
  },
  {
    name: "ClickHouse",
    directory: "langwatch/src/server/clickhouse/migrations",
    keyPattern: /^(\d{5})_/,
    keyFormat: "NNNNN_name.sql",
  },
];

type Migration = {
  entry: string;
  key: number;
};

export type SetInput = {
  set: MigrationSet;
  /** Migration entries on the tip of the base branch (e.g. origin/main). */
  baseEntries: string[];
  /** Migration entries on the pull request head. */
  headEntries: string[];
  /** Migration entries that already existed at the merge base. */
  mergeBaseEntries: string[];
  /** Entries the pull request modified, deleted or renamed relative to the merge base. */
  touchedEntries: string[];
};

const keyOf = (entry: string, set: MigrationSet): number | undefined => {
  const key = set.keyPattern.exec(entry)?.[1];
  return key === undefined ? undefined : Number(key);
};

/**
 * Only migrations the pull request adds are judged. Whatever is already on the
 * base branch is history: it may predate the naming convention, and two merged
 * migrations may even share a key. Neither is this pull request's problem.
 */
export const checkSet = ({
  set,
  baseEntries,
  headEntries,
  mergeBaseEntries,
  touchedEntries,
}: SetInput): string[] => {
  const errors: string[] = [];
  const existing = new Set([...baseEntries, ...mergeBaseEntries]);

  for (const entry of touchedEntries.filter((entry) => existing.has(entry)).sort()) {
    errors.push(
      `${set.name}: \`${entry}\` already exists on the base branch and was modified, renamed or deleted — ` +
        "applied migrations are immutable history, add a new migration instead",
    );
  }

  const added = headEntries.filter((entry) => !existing.has(entry)).sort();
  const addedMigrations: Migration[] = [];

  for (const entry of added) {
    const key = keyOf(entry, set);
    if (key === undefined) {
      errors.push(
        `${set.name}: \`${entry}\` does not start with an ordering key — name it \`${set.keyFormat}\``,
      );
      continue;
    }
    addedMigrations.push({ entry, key });
  }

  const baseKeys = new Map(
    baseEntries.flatMap((entry) => {
      const key = keyOf(entry, set);
      return key === undefined ? [] : [[key, entry] as const];
    }),
  );
  const baseHighest = [...baseKeys.keys()].reduce(
    (highest, key) => Math.max(highest, key),
    -1,
  );

  for (const migration of addedMigrations.sort((a, b) => a.key - b.key)) {
    const taken = baseKeys.get(migration.key);
    if (taken !== undefined) {
      errors.push(
        `${set.name}: \`${migration.entry}\` reuses ordering key ${migration.key}, already taken on the base branch by \`${taken}\` — ` +
          `renumber it above ${baseHighest}`,
      );
      continue;
    }
    if (migration.key <= baseHighest) {
      errors.push(
        `${set.name}: \`${migration.entry}\` sorts at or before ${baseHighest}, the highest migration already on the base branch — ` +
          `renumber it above ${baseHighest} so it runs after everything already merged`,
      );
      continue;
    }
    const twin = addedMigrations.find(
      (other) => other.key === migration.key && other.entry !== migration.entry,
    );
    if (twin !== undefined) {
      errors.push(
        `${set.name}: \`${migration.entry}\` and \`${twin.entry}\` share ordering key ${migration.key} — keys must be unique`,
      );
    }
  }

  return errors;
};

const git = (repoRoot: string, args: string[]): string =>
  execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();

const entriesAt = (
  repoRoot: string,
  ref: string,
  directory: string,
): string[] => {
  const output = git(repoRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    ref,
    "--",
    directory,
  ]);
  return topLevelEntries(output === "" ? [] : output.split("\n"), directory);
};

export const topLevelEntries = (
  paths: string[],
  directory: string,
): string[] => {
  const prefix = `${directory}/`;
  const entries = paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length).split("/")[0] ?? "")
    .filter((entry) => entry !== "" && entry !== "migration_lock.toml");
  return [...new Set(entries)].sort();
};

const touchedAt = (
  repoRoot: string,
  baseRef: string,
  directory: string,
): string[] => {
  const output = git(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=MDR",
    `${baseRef}...HEAD`,
    "--",
    directory,
  ]);
  return topLevelEntries(output === "" ? [] : output.split("\n"), directory);
};

export const main = (argv: string[]): number => {
  const baseRef = argv[0] ?? "origin/main";
  const repoRoot = argv[1] ?? ".";
  const mergeBase = git(repoRoot, ["merge-base", baseRef, "HEAD"]);

  const errors = migrationSets.flatMap((set) =>
    checkSet({
      set,
      baseEntries: entriesAt(repoRoot, baseRef, set.directory),
      headEntries: entriesAt(repoRoot, "HEAD", set.directory),
      mergeBaseEntries: entriesAt(repoRoot, mergeBase, set.directory),
      touchedEntries: touchedAt(repoRoot, baseRef, set.directory),
    }),
  );

  if (errors.length > 0) {
    console.error(`Migration ordering check failed against ${baseRef}:`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error(
      "\nMigrations run in key order, so a migration that sorts before something already merged would be skipped " +
        "on any database that is already up to date. Rebase on the base branch and renumber your migrations.",
    );
    return 1;
  }

  console.log(`Migration ordering check passed against ${baseRef}`);
  return 0;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  process.exitCode = main(process.argv.slice(2));
}
