import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Gives every workspace member a `npmDeps` named input: the npm packages it
// declares, plus the runtime npm deps of every workspace package it reaches.
// Nx hashes each with its transitive closure, so a lockfile change misses only
// the projects that reach the changed package. ADR-150 records why.
const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
const block = workspace.match(/^packages:\n((?:[ \t]+-.*\n)+)/m)?.[1] ?? "";
const members = [...block.matchAll(/-\s+(\S+)/g)].map((m) => m[1]);

const runtimeFields = ["dependencies", "peerDependencies", "optionalDependencies"];
const allFields = ["devDependencies", ...runtimeFields];
const entries = (pkg, fields) => fields.flatMap((field) => Object.entries(pkg[field] ?? {}));

// Every version pnpm-lock.yaml's packages section holds, by package name.
const lockfileVersions = (root) => {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const section = lock.slice(lock.lastIndexOf("\npackages:\n"), lock.lastIndexOf("\nsnapshots:\n"));
  const versions = new Map();
  for (const [, name, version] of section.matchAll(/^ {2}'?(@?[^@\s']+)@([^(:'\s]+)/gm))
    versions.set(name, (versions.get(name) ?? new Set()).add(version));
  return versions;
};

const manifest = (root, dir, dep) => {
  const at = join(root, dir, "node_modules", dep, "package.json");
  return existsSync(at) ? JSON.parse(readFileSync(at, "utf8")) : undefined;
};

// The key Nx gives the installed version: bare when it is the only version or
// the one hoisted to the root, else `name@version`. A bare name that is neither
// makes Nx pick a version at random, run to run. An alias resolves to its real
// package; an optional or peer dep absent on this platform is skipped.
const nodeName = (root, versions, dir, dep) => {
  const pkg = manifest(root, dir, dep);
  if (!pkg) return undefined;
  if ((versions.get(pkg.name)?.size ?? 1) === 1) return pkg.name;
  if (manifest(root, ".", pkg.name)?.version === pkg.version) return pkg.name;
  return `${pkg.name}@${pkg.version}`;
};

const reach = (pkgs, name, seen) => {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const [dep] of entries(pkgs.get(name).pkg, runtimeFields))
    if (pkgs.has(dep)) reach(pkgs, dep, seen);
  return seen;
};

export const createNodes = [
  `{${members.join(",")}}/package.json`,
  (files, _options, { workspaceRoot }) => {
    const versions = lockfileVersions(workspaceRoot);
    const pkgs = new Map(
      files.map((file) => {
        const pkg = JSON.parse(readFileSync(join(workspaceRoot, file), "utf8"));
        return [pkg.name, { dir: dirname(file), pkg }];
      }),
    );
    const external = (name, fields) =>
      entries(pkgs.get(name).pkg, fields)
        .filter(([dep, spec]) => !pkgs.has(dep) || spec.startsWith("npm:"))
        .map(([dep]) => nodeName(workspaceRoot, versions, pkgs.get(name).dir, dep));
    return [...pkgs].map(([name, { dir }]) => {
      const reached = new Set();
      for (const [dep] of entries(pkgs.get(name).pkg, allFields))
        if (pkgs.has(dep)) reach(pkgs, dep, reached);
      const names = new Set(external(name, allFields));
      for (const member of reached)
        for (const dep of external(member, runtimeFields)) names.add(dep);
      names.delete(undefined);
      const npmDeps = [{ externalDependencies: [...names].toSorted((a, b) => a.localeCompare(b)) }];
      return [join(dir, "package.json"), { projects: { [dir]: { namedInputs: { npmDeps } } } }];
    });
  },
];
