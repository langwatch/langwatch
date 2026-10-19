import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The pnpm workspace's members, read from pnpm-workspace.yaml and each member's package.json. */

export type WorkspaceMember = {
  readonly name: string;
  readonly directory: string;
  readonly dependencies: readonly string[];
  readonly developmentDependencies: readonly string[];
};

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function workspaceGlobs(root: string): string[] {
  // The `packages:` block of pnpm-workspace.yaml is a flat list of quoted globs;
  // reading it by hand keeps this derivation free of a YAML dependency.
  const manifest = join(root, "pnpm-workspace.yaml");
  if (!existsSync(manifest)) return [];

  const globs: string[] = [];
  let inside = false;

  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }

    if (inside && /^\S/.test(line)) break;

    const entry = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/.exec(line);
    if (inside && entry?.[1]) globs.push(entry[1]);
  }

  return globs;
}

/** The child directories a `*` segment matches: no dot directories, no node_modules. */
function wildcardChildren(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
    )
    .map((entry) => join(directory, entry.name));
}

function namedChild(directory: string, segment: string): string[] {
  const candidate = join(directory, segment);
  if (!existsSync(candidate)) return [];
  return statSync(candidate).isDirectory() ? [candidate] : [];
}

export function expandGlob(root: string, pattern: string): string[] {
  let directories = [root];
  for (const segment of pattern.split("/")) {
    directories = directories.flatMap((directory) =>
      segment === "*" ? wildcardChildren(directory) : namedChild(directory, segment),
    );
  }
  return directories;
}

function workspaceNames(dependencies: Record<string, string> | undefined): string[] {
  return Object.entries(dependencies ?? {})
    .filter(([, range]) => range.startsWith("workspace:"))
    .map(([name]) => name)
    .toSorted();
}

export function readWorkspaceMembers(root: string): WorkspaceMember[] {
  const members = new Map<string, WorkspaceMember>();

  for (const pattern of workspaceGlobs(root)) {
    for (const directory of expandGlob(root, pattern)) {
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
      if (!manifest.name) continue;

      members.set(manifest.name, {
        name: manifest.name,
        directory,
        dependencies: workspaceNames(manifest.dependencies),
        developmentDependencies: workspaceNames(manifest.devDependencies),
      });
    }
  }

  return [...members.values()].toSorted((left, right) => (left.name < right.name ? -1 : 1));
}
