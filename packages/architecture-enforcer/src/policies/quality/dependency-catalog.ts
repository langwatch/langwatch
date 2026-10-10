import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { expandGlob, workspaceGlobs } from "../../workspace/tsconfig-references.ts";
import { readWorkspaceCatalogs } from "../boundaries/manifests.ts";

/**
 * `dependency-catalog`: one external package is one version across the workspace.
 * `catalogMode: strict` does not police a hand-edited manifest, so two members
 * with two ranges of one package ship two copies of it.
 */

const POLICY = "dependency-catalog";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

const NOT_EXTERNAL = ["workspace:", "file:", "link:"];

type Declaration = { manifestPath: string; name: string; range: string; text: string };

/** Every external dependency a manifest declares; peer ranges are stated on purpose. */
function manifestDeclarations(manifestPath: string): Declaration[] {
  const text = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>;

  return DEPENDENCY_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {})).flatMap(
    ([name, range]) =>
      NOT_EXTERNAL.some((prefix) => range.startsWith(prefix))
        ? []
        : [{ manifestPath, name, range, text }],
  );
}

/** Every external dependency each workspace member declares. */
function declarations(root: string): Declaration[] {
  const manifests = new Set(
    workspaceGlobs(root)
      .flatMap((pattern) => expandGlob(root, pattern))
      .map((directory) => join(directory, "package.json"))
      .filter((manifestPath) => existsSync(manifestPath)),
  );

  return [...manifests].flatMap(manifestDeclarations);
}

function lineOf({ text, name }: { text: string; name: string }): number | undefined {
  const index = text.split("\n").findIndex((line) => line.includes(`${JSON.stringify(name)}:`));

  return index < 0 ? undefined : index + 1;
}

export function lintDependencyCatalog(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const { catalog, catalogs } = readWorkspaceCatalogs(root);
  const catalogued = new Set([
    ...Object.keys(catalog),
    ...Object.values(catalogs).flatMap(Object.keys),
  ]);

  const all = declarations(root);
  const members = new Map<string, Set<string>>();
  for (const { name, manifestPath } of all) {
    members.set(name, (members.get(name) ?? new Set()).add(manifestPath));
  }

  return all.flatMap(({ manifestPath, name, range, text }) => {
    if (range.startsWith("catalog:")) return [];

    const line = lineOf({ text, name });
    const shared = (members.get(name)?.size ?? 0) > 1;

    if (catalogued.has(name)) {
      return [
        {
          policy: POLICY,
          file: manifestPath,
          line,
          specifier: name,
          message: `${name} is in the catalog in pnpm-workspace.yaml but is declared as "${range}" here.`,
          allowed: `Write "catalog:" (or "catalog:<name>" for a named catalog) so the whole workspace resolves one version.`,
        },
      ];
    }

    if (!shared) return [];

    return [
      {
        policy: POLICY,
        file: manifestPath,
        line,
        specifier: name,
        message: `${name} is declared by ${members.get(name)?.size} workspace members, so it is not pinned in one place.`,
        allowed: `Add ${name} to the catalog in pnpm-workspace.yaml and write "catalog:" in every member.`,
      },
    ];
  });
}
