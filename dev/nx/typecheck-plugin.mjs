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

/** One project's typecheck: its own files, and what its dependencies' tasks emitted. */
export function typecheckTarget(root, dir) {
  const manifest = manifestOf(root, dir);
  const scripts = manifest.scripts ?? {};
  const own = referenced(root, dir, new Set(), (file) => file.startsWith(`${dir}/`));
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
      { dependentTasksOutputFiles: "**/*.{ts,tsx,mts,cts,json}", transitive: true },
    ],
    outputs: [...declarations, ...buildInfoOutsideDist(root, own)],
    syncGenerators: ["@nx/js:typescript-sync"],
  };
}

export const createNodes = [
  `{${members.join(",")}}/tsconfig.json`,
  (files, _options, { workspaceRoot }) =>
    files
      .filter((file) => existsSync(join(workspaceRoot, dirname(file), "package.json")))
      .map((file) => {
        const dir = dirname(file);
        const targets = { typecheck: typecheckTarget(workspaceRoot, dir) };
        return [join(dir, "package.json"), { projects: { [dir]: { targets } } }];
      }),
];
