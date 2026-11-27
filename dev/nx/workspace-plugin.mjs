import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { parseJson } from "nx/src/devkit-exports.js";

// Project `workspace` (at dev/nx: no project owns the root) holds the repo-wide builds:
// `build:types` (`tsc -b` over every module contract's build config, declarations into the dist of
// every project those reference) plus `lint:rules` and `test:scripts`, which run the Makefile
// recipes as `lint:go` does. Keyed on nx.json, which every workspace has. ADR-150 records why.
const contracts = "modules/*/contract/tsconfig.build.json";

// tsconfig files are JSONC: comments and trailing commas are allowed.
const readConfig = (root, file) => parseJson(readFileSync(join(root, file), "utf8"));

// Declarations only: a project whose own `build` emits its published `.d.ts`
// (ksuid) keeps those, and this target owns just its maps and build info, plus the
// `.d.ts` its declaration config writes to a dist subdirectory (mail: dist/typecheck).
const declarationOutputs = (root, dir) => {
  const manifest = join(root, dir, "package.json");
  const ownBuild =
    existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).scripts?.build;
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

// A reference names a config or, for a package with no build config, its directory.
const referenced = (root, reference, seen) => {
  const file = reference.endsWith(".json") ? reference : join(reference, "tsconfig.json");
  if (seen.has(file)) return seen;
  seen.add(file);
  const config = readConfig(root, file);
  for (const { path } of config.references ?? [])
    referenced(root, normalize(join(dirname(file), path)), seen);
  return seen;
};

// Build info a config writes outside its dist (apps/docs keeps it in .tsbuild).
const buildInfoOutsideDist = (root, configs) =>
  [...configs].flatMap((file) => {
    const config = readConfig(root, file);
    const info = config.compilerOptions?.tsBuildInfoFile;
    const path = info && normalize(join(dirname(file), info));
    return path && !path.split("/").includes("dist") ? [`{workspaceRoot}/${path}`] : [];
  });

const contractBuilds = (root) =>
  readdirSync(join(root, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `modules/${entry.name}/contract/tsconfig.build.json`)
    .filter((file) => existsSync(join(root, file)));

export const createNodes = [
  "nx.json",
  (files, _options, { workspaceRoot }) =>
    files.map((file) => {
      const seen = new Set();
      for (const build of contractBuilds(workspaceRoot)) referenced(workspaceRoot, build, seen);
      const dirs = [...new Set([...seen].map(dirname))];
      const inputs = [
        "{workspaceRoot}/tsconfig.*json",
        "{workspaceRoot}/pnpm-lock.yaml",
        { runtime: "node --version" },
        { externalDependencies: ["typescript"] },
        { dependentTasksOutputFiles: "**/*.d.ts" },
        ...dirs.flatMap((dir) => [
          `{workspaceRoot}/${dir}/src/**/*`,
          `{workspaceRoot}/${dir}/tsconfig*.json`,
          `{workspaceRoot}/${dir}/package.json`,
        ]),
      ];
      const outputs = dirs.flatMap((dir) => declarationOutputs(workspaceRoot, dir));
      const target = {
        executor: "nx:run-commands",
        options: {
          cwd: "{workspaceRoot}",
          command: `GOMAXPROCS=2 GOMEMLIMIT=2GiB sh dev/scripts/with-build-slot.sh build:types tsc -b --builders 1 ${contracts}`,
        },
        cache: true,
        inputs,
        outputs,
        dependsOn: ["@langwatch/prisma-client:prisma:generate", "langwatch:build"],
      };
      const make = (recipe, tool, extra) => ({
        executor: "nx:run-commands",
        options: { cwd: "{workspaceRoot}", command: `make --no-print-directory ${recipe}` },
        cache: true,
        inputs: ["{workspaceRoot}/Makefile", { runtime: tool }, ...extra],
        outputs: [],
      });
      const everything = [
        "{workspaceRoot}/**/*",
        "!{workspaceRoot}/.claude/**/*",
        "!{workspaceRoot}/.nx/**/*",
      ];
      // The one root `tsc -b` (`pnpm typecheck`, bare `nx typecheck`), cached on the sources
      // of what it reads and of the files its dependencies generate, never on dist contents
      // (CI restores older ones); its tsbuildinfo stays the incremental cache on a miss.
      // `nx sync` writes every project reference first (ADR-150, 2026-10-10, 2026-11-27).
      const solution = referenced(workspaceRoot, "tsconfig.json", new Set());
      const solutionDirs = [...new Set([...solution].map(dirname))].filter((dir) => dir !== ".");
      const typecheck = {
        executor: "nx:run-commands",
        options: {
          cwd: "{workspaceRoot}",
          command: "GOMAXPROCS=2 GOMEMLIMIT=2GiB tsc -b --builders 1 --checkers 1",
        },
        cache: true,
        inputs: [
          "{workspaceRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}",
          "!{workspaceRoot}/.claude/**/*",
          "!{workspaceRoot}/.nx/**/*",
          "{workspaceRoot}/**/*.prisma",
          "{workspaceRoot}/sdks/typescript/copy-types.sh",
          "{workspaceRoot}/skills/**/*",
          "{workspaceRoot}/pnpm-lock.yaml",
          { env: "LANGWATCH_SKILLS_RENDER" },
          { runtime: "node --version" },
        ],
        outputs: [
          ...solutionDirs.flatMap((dir) => declarationOutputs(workspaceRoot, dir)),
          ...buildInfoOutsideDist(workspaceRoot, solution),
        ],
        syncGenerators: ["@nx/js:typescript-sync"],
        dependsOn: [
          "@langwatch/prisma-client:prisma:generate",
          ...["langwatch", "@langwatch/mcp-server", "@langwatch/ksuid", "@langwatch/mail"].map(
            (project) => `${project}:build`,
          ),
        ],
      };
      // Local default: the same root build without the test programs; CI runs `typecheck`.
      const sourceTypecheck = {
        ...typecheck,
        options: { cwd: "{workspaceRoot}", command: "node dev/scripts/typecheck-src.mjs" },
      };
      // `pnpm lint` and `pnpm lint:types` over a resolved scope (dev/nx/lint.mjs passes it
      // as arguments, which Nx hashes); the plugin rules read files beyond the linted ones.
      // The type-aware run reads the packages' dist declarations, so it runs after
      // `typecheck`, which derives them from the same hashed sources.
      const lintTree = {
        executor: "nx:run-commands",
        options: { cwd: "{workspaceRoot}", command: "node dev/nx/lint.mjs" },
        cache: true,
        inputs: [...everything, { env: "LANGWATCH_SKILLS_RENDER" }, { runtime: "node --version" }],
        outputs: [],
        dependsOn: typecheck.dependsOn,
      };
      const lintTreeTypes = { ...lintTree, dependsOn: [...typecheck.dependsOn, "typecheck"] };
      const targets = {
        typecheck,
        "lint:tree": lintTree,
        "lint:tree:types": lintTreeTypes,
        "typecheck:src": sourceTypecheck,
        "build:types": target,
        "lint:rules": make("lint-rules-run", "uvx --version", everything),
        "test:scripts": make("test-scripts-run", "bats --version", [
          "{workspaceRoot}/dev/scripts/**/*",
        ]),
      };
      return [file, { projects: { "dev/nx": { name: "workspace", targets } } }];
    }),
];
