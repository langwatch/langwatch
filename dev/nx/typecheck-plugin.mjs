import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { parseJson } from "nx/src/devkit-exports.js";

import { memberPatterns } from "./workspace-members.mjs";

// Makes each package's `typecheck` script (`tsc -b` over its container tsconfig.json)
// a cached Nx task that runs after its dependencies' typecheck and hashes their
// declarations, so a change re-checks only the projects whose inputs changed and the
// rest replay from the cache (ADR-150, 2026-11-27 amendments).
const members = memberPatterns(new URL("../..", import.meta.url).pathname);

// tsconfig files are JSONC: comments and trailing commas are allowed.
export const readConfig = (root, file) => parseJson(readFileSync(join(root, file), "utf8"));

const manifestOf = (root, dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));

// Declarations only: a project whose own `build` emits its published `.d.ts`
// (ksuid) keeps those, and typecheck owns just its maps and build info, plus the
// `.d.ts` its declaration config writes to a dist subdirectory (mail: dist/typecheck).
export const declarationOutputs = (root, dir) => {
  const ownBuild =
    existsSync(join(root, dir, "package.json")) && manifestOf(root, dir).scripts?.build;
  const buildConfig = join(dir, "tsconfig.build.json");
  const outDir = existsSync(join(root, buildConfig))
    ? normalize(readConfig(root, buildConfig).compilerOptions?.outDir ?? "dist")
    : "dist";
  const own = outDir.startsWith("dist/") ? [`${outDir}/**/*.d.ts`] : [];
  const globs = ["dist/**/*.d.ts.map", "dist/**/*.tsbuildinfo"];
  return (ownBuild ? [...own, ...globs] : ["dist/**/*.d.ts", ...globs]).map(
    (g) => `{workspaceRoot}/${dir}/${g}`,
  );
};

const configOf = (path) => (path.endsWith(".json") ? path : join(path, "tsconfig.json"));

// Every config a reference reaches; `within` stops the walk at a directory boundary.
export const referenced = (root, reference, seen, within = () => true) => {
  const file = configOf(reference);
  if (seen.has(file) || !within(file)) return seen;
  seen.add(file);
  for (const { path } of readConfig(root, file).references ?? [])
    referenced(root, normalize(join(dirname(file), path)), seen, within);
  return seen;
};

const asConfig = (path) => (path.endsWith(".json") ? path : `${path}.json`);

// Configs outside the project that its own configs extend (tsconfig.emit.json, a base).
export const inheritedConfigs = (root, configs, dir) => {
  const seen = new Set();
  const visit = (file) => {
    for (const parent of [readConfig(root, file).extends ?? []].flat()) {
      if (!parent.startsWith(".")) continue;
      const path = asConfig(normalize(join(dirname(file), parent)));
      if (seen.has(path)) continue;
      if (!existsSync(join(root, path))) continue;
      seen.add(path);
      visit(path);
    }
  };
  for (const file of configs) visit(file);
  return [...seen]
    .filter((file) => !file.startsWith(`${dir}/`))
    .toSorted((a, b) => a.localeCompare(b));
};

// Build info a config writes outside its dist (apps/docs keeps it in .tsbuild).
export const buildInfoOutsideDist = (root, configs) =>
  [...configs].flatMap((file) => {
    const info = readConfig(root, file).compilerOptions?.tsBuildInfoFile;
    const path = info && normalize(join(dirname(file), info));
    return path && !path.split("/").includes("dist") ? [`{workspaceRoot}/${path}`] : [];
  });

// The generators whose gitignored output a project's own sources import.
const GENERATORS = [
  "prisma:generate",
  "generate:evaluators",
  "generate:langy-skills",
  "generate:feature-map",
  "generate:setup-skill-bodies",
];

const workspaceDeps = (manifest, { dev }) =>
  Object.keys({
    ...manifest.dependencies,
    ...(dev ? manifest.devDependencies : {}),
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });

// A dependency with no declaration build is read from source, so its dependants hash
// its production files. Past the project itself only runtime dependencies count: a
// dependency's devDependencies never reach its dependants.
export const sourceOnlyDependencies = (root, dir, dirsByName) => {
  const found = new Set();
  const seen = new Set([dir]);
  const visit = (at) => {
    for (const name of workspaceDeps(manifestOf(root, at), { dev: at === dir })) {
      const depDir = dirsByName.get(name);
      if (depDir === undefined || seen.has(depDir)) continue;
      seen.add(depDir);
      const manifest = manifestOf(root, depDir);
      const typesFromBuild =
        manifest.scripts?.build !== undefined && typeof manifest.types === "string";
      if (!existsSync(join(root, depDir, "tsconfig.build.json")) && !typesFromBuild)
        found.add(name);
      visit(depDir);
    }
  };
  visit(dir);
  return [...found].toSorted((a, b) => a.localeCompare(b));
};

/** One project's typecheck: its own files, and what its dependencies' tasks emitted. */
export function typecheckTarget(root, dir, dirsByName = new Map()) {
  const manifest = manifestOf(root, dir);
  const scripts = manifest.scripts ?? {};
  const own = referenced(root, dir, new Set(), (file) => file.startsWith(`${dir}/`));
  const sourceOnly = sourceOnlyDependencies(root, dir, dirsByName);
  // A package whose published types are its build's output (the SDK, ksuid) builds first,
  // and every `.d.ts` in its dist is a typecheck output too: dependants hash what is on
  // disk after the typecheck, whichever of the two wrote it, so a run and a replay agree.
  const typesFromBuild = scripts.build !== undefined && typeof manifest.types === "string";
  const declarations = ["dist/**/*.d.ts", "dist/**/*.d.ts.map", "dist/**/*.tsbuildinfo"].map(
    (glob) => `{workspaceRoot}/${dir}/${glob}`,
  );
  return {
    cache: true,
    dependsOn: [
      "^typecheck",
      ...GENERATORS.filter((target) => scripts[target] !== undefined),
      ...(typesFromBuild ? ["build"] : []),
    ],
    inputs: [
      "default",
      "!{projectRoot}/**/*.md",
      "npmDeps",
      { externalDependencies: ["typescript"] },
      ...inheritedConfigs(root, own, dir).map((file) => `{workspaceRoot}/${file}`),
      { dependentTasksOutputFiles: "**/*.{ts,tsx,mts,cts,json}", transitive: true },
      ...(sourceOnly.length > 0 ? [{ input: "production", projects: sourceOnly }] : []),
    ],
    outputs: [...declarations, ...buildInfoOutsideDist(root, own)],
    syncGenerators: ["@nx/js:typescript-sync"],
  };
}

export const createNodes = [
  `{${members.join(",")}}/tsconfig.json`,
  (files, _options, { workspaceRoot }) => {
    const dirs = files
      .map((file) => dirname(file))
      .filter((dir) => existsSync(join(workspaceRoot, dir, "package.json")));
    const dirsByName = new Map(dirs.map((dir) => [manifestOf(workspaceRoot, dir).name, dir]));
    return dirs.map((dir) => {
      const targets = { typecheck: typecheckTarget(workspaceRoot, dir, dirsByName) };
      return [join(dir, "package.json"), { projects: { [dir]: { targets } } }];
    });
  },
];
