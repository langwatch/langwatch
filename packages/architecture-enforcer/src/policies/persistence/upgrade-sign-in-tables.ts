import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { POSTGRES_TOUCH, postgresOwners, SQL_COMMENT } from "./migration-owners.ts";

/**
 * The api serves while the worker runs blocking steps, so a blocking step's SQL never touches a
 * sign-in or ingest door's table (Alex, 2026-10-09, UIW-9), and touches only tables created in
 * its own release, which no released image reads (Alex, 2026-10-09).
 */

const POLICY = "upgrade-sign-in-tables";
const SIGN_IN_OWNERS: ReadonlySet<string> = new Set([
  "auth",
  "user",
  "organization",
  "authz",
  "identity",
  "api-key",
  "project",
  "evaluation",
  "evaluator",
  "model-provider",
  "monitor",
  "experiment",
  "governance",
]);
const ALLOWED =
  "Ship the change as a background step (expand/contract); the api serves sign-in and ingestion while the worker runs blocking steps (Alex, 2026-10-09, UIW-9).";
const OLDER_TABLE_FIX =
  "A blocking data step may touch only tables created in its own release; ship it as a background step, ordered with `after:` (Alex, 2026-10-09).";
const PRISMA_MIGRATIONS = "packages/prisma-client/prisma/migrations";
const RELEASES = "packages/upgrade/releases";
const NO_RELEASE_TAG =
  "No langwatch@v* release tag with Prisma migrations in this clone, so released tables cannot be " +
  "told from new ones. Fetch the tags: git fetch --tags origin (CI: " +
  "git fetch --depth=1 origin '+refs/tags/langwatch@v*:refs/tags/langwatch@v*').";
// Real findings listed for a fix (2026-10-09); never add to it.
const OPEN_STEPS: ReadonlySet<string> = new Set(["ops:copy-automation-migration-state"]);
const CREATE_TABLE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?/gi;
const TS_COMMENT = /^\s*\/\/.*$/gm;
const MIGRATION_REPOSITORY = /^prisma\..+-migration\.repository\.ts$/;
const NEXT_MEMBER = /\n {2}(?:(?:async|static|private|public|protected)\s+)*\w+\s*[(<]/;

type BlockingStep = { id: string; calls: string[] };

/** Table name to owning module, for every table a sign-in owner claims. */
export function signInTables({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): Map<string, string> {
  return new Map(
    [...postgresOwners(root, catalogue)].filter(([, owner]) => SIGN_IN_OWNERS.has(owner)),
  );
}

function filesIn({ directory, accept }: { directory: string; accept: (name: string) => boolean }) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter(accept)
    .map((name) => join(directory, name));
}

function blockingStepsOf(text: string): BlockingStep[] {
  return text
    .split("defineMigrationStep(")
    .slice(1)
    .filter((chunk) => /mode:\s*"blocking"/.test(chunk))
    .flatMap((chunk) => {
      const id = /id:\s*"([^"]+)"/.exec(chunk)?.[1];
      if (!id) return [];

      return [{ id, calls: [...chunk.matchAll(/\.(\w+)\(/g)].map((match) => match[1] ?? "") }];
    });
}

function methodBody({ source, name }: { source: string; name: string }): string {
  const start = new RegExp(
    `\\n {2}(?:(?:async|static|private|public|protected)\\s+)*${name}\\s*\\(`,
  ).exec(source);
  if (!start) return "";
  const rest = source.slice(start.index + 1);
  const end = NEXT_MEMBER.exec(rest);

  return end ? rest.slice(0, end.index) : rest;
}

function ownersTouched({
  sql,
  tables,
}: {
  sql: string;
  tables: ReadonlyMap<string, string>;
}): Map<string, string[]> {
  const touched = new Map<string, string[]>();

  for (const match of sql
    .replace(TS_COMMENT, "")
    .replace(SQL_COMMENT, "")
    .matchAll(POSTGRES_TOUCH)) {
    const table = match[1] ?? "";
    const owner = tables.get(table);
    if (!owner) continue;
    const named = touched.get(owner) ?? [];
    if (!named.includes(table)) named.push(table);
    touched.set(owner, named);
  }

  return touched;
}

/** The newest migration in the newest `langwatch@v*` tag; throws when no tag is readable. */
function newestTaggedMigration({ root }: { root: string }): string {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
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
  throw new Error(NO_RELEASE_TAG, { cause });
}

/** The newest released Prisma migration: the newest tag's, or a later one a manifest names. */
export function releasedThrough({ root }: { root: string }): string {
  const named = filesIn({
    directory: join(root, RELEASES),
    accept: (name) => name.endsWith(".json"),
  })
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"id":\s*"prisma:(\w+)"/g)])
    .map((match) => match[1] ?? "");

  return [newestTaggedMigration({ root }), ...named].toSorted().at(-1)!;
}

/** Each table a Prisma migration creates, with the first migration that creates it. */
export function tableCreations({ root }: { root: string }): Map<string, string> {
  const created = new Map<string, string>();
  const directory = join(root, PRISMA_MIGRATIONS);
  const names = existsSync(directory) ? readdirSync(directory).toSorted() : [];
  for (const name of names) {
    const file = join(directory, name, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8").replace(SQL_COMMENT, "");
    for (const match of sql.matchAll(CREATE_TABLE)) {
      const table = match[1] ?? "";
      if (!created.has(table)) created.set(table, name);
    }
  }

  return created;
}

function olderTables({
  sql,
  created,
  released,
}: {
  sql: string;
  created: ReadonlyMap<string, string>;
  released: string;
}): string[] {
  const names = [...sql.replace(TS_COMMENT, "").replace(SQL_COMMENT, "").matchAll(POSTGRES_TOUCH)]
    .map((match) => match[1] ?? "")
    .filter((table) => {
      const at = created.get(table);
      return at !== undefined && at <= released;
    });

  return [...new Set(names)];
}

/** Every blocking step touching a sign-in owner's table or one an earlier release created. */
export function lintUpgradeSignInTablesAt({
  root,
  catalogue,
  released = releasedThrough({ root }),
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  /** The newest released Prisma migration; a fixture outside a clone names it. */
  released?: string;
}): ArchitectureViolation[] {
  const tables = signInTables({ root, catalogue });
  const created = tableCreations({ root });

  return catalogue.flatMap((feature) => {
    const source = join(root, feature.root, "process", "src");
    const steps = filesIn({
      directory: source,
      accept: (name) => name.endsWith(".module.ts"),
    }).flatMap((file) => blockingStepsOf(readFileSync(file, "utf8")));
    const repositories = filesIn({
      directory: join(source, "repositories", "prisma"),
      accept: (name) => MIGRATION_REPOSITORY.test(name),
    });

    return steps.flatMap((step) =>
      repositories.flatMap((file) => {
        const text = readFileSync(file, "utf8");
        const sql = step.calls.map((name) => methodBody({ source: text, name })).join("\n");
        const touched = ownersTouched({ sql, tables });
        const older = OPEN_STEPS.has(step.id) ? [] : olderTables({ sql, created, released });
        const named = [...touched].map(([owner, names]) => `${owner} (${names.join(", ")})`);

        return [
          ...(touched.size === 0
            ? []
            : [
                {
                  policy: POLICY,
                  file,
                  message: `Blocking step "${step.id}" touches the sign-in tables of ${named.join(" and ")}.`,
                  allowed: ALLOWED,
                } satisfies ArchitectureViolation,
              ]),
          ...(older.length === 0
            ? []
            : [
                {
                  policy: POLICY,
                  file,
                  message: `Blocking step "${step.id}" touches ${older.join(", ")}, created before this release.`,
                  allowed: OLDER_TABLE_FIX,
                } satisfies ArchitectureViolation,
              ]),
        ];
      }),
    );
  });
}

/** The registry entry. */
export function lintUpgradeSignInTables(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintUpgradeSignInTablesAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
