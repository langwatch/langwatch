import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { POSTGRES_TOUCH, postgresOwners, SQL_COMMENT } from "./migration-owners.ts";

/**
 * The api serves sign-in while the worker runs blocking upgrade steps, so a blocking step's
 * frozen SQL never touches a table the sign-in owners claim (Alex, 2026-10-09, UIW-9).
 */

const POLICY = "upgrade-sign-in-tables";
const SIGN_IN_OWNERS: ReadonlySet<string> = new Set([
  "auth",
  "user",
  "organization",
  "authz",
  "identity",
]);
const ALLOWED =
  "Ship the change as a background step (expand/contract); the api serves sign-in while the worker runs blocking steps (Alex, 2026-10-09, UIW-9).";
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

/** Every blocking step whose frozen SQL touches a sign-in owner's table, in module order. */
export function lintUpgradeSignInTablesAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  const tables = signInTables({ root, catalogue });

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
        if (touched.size === 0) return [];
        const named = [...touched].map(([owner, names]) => `${owner} (${names.join(", ")})`);

        return [
          {
            policy: POLICY,
            file,
            message: `Blocking step "${step.id}" touches the sign-in tables of ${named.join(" and ")}.`,
            allowed: ALLOWED,
          } satisfies ArchitectureViolation,
        ];
      }),
    );
  });
}

/** The registry entry. */
export function lintUpgradeSignInTables(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintUpgradeSignInTablesAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
