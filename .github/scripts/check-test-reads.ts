// Fails when a cached test read a file its Nx cache key does not hash: outside its own
// package, its dependencies' production files, sharedGlobals and its `testReads` row.
// The reads come from dev/nx/test-reads-hook.cjs, loaded by the package-suites job.
// ADR-150, "tests that read outside their package declare it".

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { reads as declaredReads } from "../../dev/nx/test-reads-plugin.mjs";
import { memberRoots } from "../../dev/nx/workspace-members.mjs";

export interface Member {
  root: string;
  dependencies: string[];
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
// `^production` leaves these out of a dependency's hash (nx.json namedInputs).
const notProduction = /\.test\.(ts|tsx|mts)$|(^|\/)vitest(\.integration)?\.config\.[^/]+$/;

// Nx's input globs match dot-files; path.matchesGlob does not, so both sides hide the dot.
const undot = (text: string) => text.replace(/(^|\/)\./g, "$1\u2024");
const matches = ({ path, glob }: { path: string; glob: string }) =>
  matchesGlob(undot(path), undot(glob));

const within = ({ path, dir }: { path: string; dir: string }) =>
  dir === "" || path === dir || path.startsWith(`${dir}/`);

/** The directory part of a glob before its first wildcard. */
export const globBase = (glob: string): string => {
  const segments = glob.split("/");
  const wild = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return (wild === -1 ? segments : segments.slice(0, wild)).join("/");
};

/** A package and every workspace package it reaches, as Nx's `^` inputs walk them. */
export const closureOf = ({
  name,
  members,
}: {
  name: string;
  members: Map<string, Member>;
}): Set<string> => {
  const seen = new Set<string>();
  const queue = [name];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const dependency of members.get(next)?.dependencies ?? []) {
      if (dependency !== name && !seen.has(dependency) && members.has(dependency)) {
        seen.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return seen;
};

/** A directory is covered when it holds, or lies inside, an area the key hashes. */
export const isCovered = ({
  path,
  isDirectory,
  ownRoot,
  dependencyRoots,
  globs,
}: {
  path: string;
  isDirectory: boolean;
  ownRoot: string;
  dependencyRoots: string[];
  globs: string[];
}): boolean => {
  if (within({ path, dir: ownRoot })) return true;
  if (!isDirectory) {
    const inDependency = dependencyRoots.some((dir) => within({ path, dir }));
    return (
      (inDependency && !notProduction.test(path)) || globs.some((glob) => matches({ path, glob }))
    );
  }
  const areas = [ownRoot, ...dependencyRoots, ...globs.map(globBase)];
  return areas.some((area) => within({ path, dir: area }) || within({ path: area, dir: path }));
};

/** The row to paste: the existing globs, plus a lone file as itself and a crowd as its area. */
export const suggestRow = ({
  name,
  existing,
  uncovered,
}: {
  name: string;
  existing: string[];
  uncovered: { path: string; isDirectory: boolean }[];
}): string => {
  const groups = new Map<string, { path: string; isDirectory: boolean }[]>();
  for (const read of uncovered) {
    const segments = read.path.split("/");
    const key = segments.length <= 2 ? read.path : segments.slice(0, 2).join("/");
    groups.set(key, [...(groups.get(key) ?? []), read]);
  }
  const added = [...groups].map(([key, group]) =>
    group.length === 1 && !group[0].isDirectory ? group[0].path : `${key}/**/*`,
  );
  const row = [...new Set([...existing, ...added])].map((glob) => JSON.stringify(glob));
  return `${JSON.stringify(name)}: [${row.join(", ")}],`;
};

/** Each package's recorded reads, from the hook's `<name with __>.<pid>.log` files. */
export const readLogs = (dir: string): Map<string, Set<string>> => {
  const recorded = new Map<string, Set<string>>();
  if (!existsSync(dir)) return recorded;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".log"))) {
    const name = basename(file, ".log")
      .replace(/\.\d+$/, "")
      .replace("__", "/");
    const paths = recorded.get(name) ?? new Set<string>();
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (line !== "") paths.add(line);
    }
    recorded.set(name, paths);
  }
  return recorded;
};

interface TargetDefault {
  cache?: boolean;
  filter?: { projects?: string[] };
}

/** Every uncached test project, from `cache: false` entries on test targets in nx.json. */
export const uncachedProjects = (nxJson: {
  targetDefaults?: Record<string, TargetDefault | TargetDefault[]>;
}): Set<string> => {
  const uncached = new Set<string>();
  for (const target of ["test", "test:unit"]) {
    for (const { cache, filter } of [nxJson.targetDefaults?.[target] ?? []].flat()) {
      if (cache === false) for (const project of filter?.projects ?? []) uncached.add(project);
    }
  }
  return uncached;
};

export const check = ({
  recorded,
  members,
  reads,
  sharedGlobals,
  uncached,
  kindOf,
  ignoredOf,
}: {
  recorded: Map<string, Set<string>>;
  members: Map<string, Member>;
  reads: Record<string, string[]>;
  sharedGlobals: string[];
  uncached: Set<string>;
  /** Undefined for a path Nx cannot hash: missing (a probe) or git-ignored (an output). */
  kindOf: (path: string) => "file" | "directory" | undefined;
  /** The given paths git ignores: outputs, never inputs Nx could hash. */
  ignoredOf: (paths: string[]) => Set<string>;
}): string[] => {
  const errors: string[] = [];
  for (const [name, paths] of [...recorded].toSorted(([a], [b]) => a.localeCompare(b))) {
    const member = members.get(name);
    if (member === undefined || uncached.has(name)) continue;
    const dependencyRoots = [...closureOf({ name, members })].flatMap(
      (dependency) => members.get(dependency)?.root ?? [],
    );
    const globs = [...sharedGlobals, ...(reads[name] ?? [])];
    const candidates = [...paths]
      .toSorted()
      .flatMap((path) => {
        const kind = kindOf(path);
        return kind === undefined ? [] : [{ path, isDirectory: kind === "directory" }];
      })
      .filter(
        ({ path, isDirectory }) =>
          !isCovered({ path, isDirectory, ownRoot: member.root, dependencyRoots, globs }),
      );
    const ignored = ignoredOf(candidates.map(({ path }) => path));
    const uncovered = candidates.filter(({ path }) => !ignored.has(path));
    if (uncovered.length === 0) continue;
    errors.push(
      `::error::${name}'s tests read ${uncovered.length} path(s) their cache key does not hash, ` +
        `so a change there replays a stale pass. Put this row in \`reads\` in ` +
        `dev/nx/test-reads-plugin.mjs:`,
      `  ${suggestRow({ name, existing: reads[name] ?? [], uncovered })}`,
      ...uncovered.slice(0, 20).map(({ path }) => `    read: ${path}`),
    );
  }
  return errors;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const root = resolve(import.meta.dirname, "../..");
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("usage: check-test-reads.ts <directory of test-reads-hook logs>");
    process.exit(2);
  }
  const members = new Map<string, Member>();
  for (const memberRoot of memberRoots(root)) {
    const manifest = JSON.parse(readFileSync(join(root, memberRoot, "package.json"), "utf8"));
    const dependencies = dependencyFields.flatMap((field) => Object.keys(manifest[field] ?? {}));
    members.set(manifest.name, { root: memberRoot, dependencies });
  }
  const nxJson = JSON.parse(readFileSync(join(root, "nx.json"), "utf8"));
  const recorded = readLogs(dir);
  const errors = check({
    recorded,
    members,
    reads: declaredReads,
    sharedGlobals: (nxJson.namedInputs?.sharedGlobals ?? []).map((glob: string) =>
      glob.replace("{workspaceRoot}/", ""),
    ),
    uncached: uncachedProjects(nxJson),
    ignoredOf: (paths) =>
      new Set(
        paths.length === 0
          ? []
          : spawnSync("git", ["check-ignore", "--stdin"], {
              cwd: root,
              encoding: "utf8",
              input: paths.join("\n"),
            }).stdout.split("\n"),
      ),
    kindOf: (path) => {
      const stat = statSync(join(root, path), { throwIfNoEntry: false });
      if (stat === undefined) return undefined;
      return stat.isDirectory() ? "directory" : "file";
    },
  });
  for (const line of errors) console.log(line);
  console.log(`Checked the outside reads of ${recorded.size} package test run(s).`);
  if (errors.length > 0) process.exit(1);
}
