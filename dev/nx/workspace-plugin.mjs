import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Project `workspace` (at dev/nx: no project owns the root) holds the repo-wide builds:
// `build:types` (`tsc -b` over every module contract's build config, declarations into the dist of
// every project those reference) plus `lint:rules` and `test:scripts`, which run the Makefile
// recipes as `lint:go` does. Keyed on nx.json, which every workspace has. ADR-150 records why.
const contracts = "modules/*/contract/tsconfig.build.json";

// Declarations only: a project whose own `build` emits its published `.d.ts`
// (ksuid) keeps those, and this target owns just its maps and build info.
const declarationOutputs = (root, dir) => {
  const manifest = join(root, dir, "package.json");
  const ownBuild =
    existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).scripts?.build;
  const globs = ["dist/**/*.d.ts.map", "dist/**/*.tsbuildinfo"];
  return (ownBuild ? globs : ["dist/**/*.d.ts", ...globs]).map(
    (g) => `{workspaceRoot}/${dir}/${g}`,
  );
};

// A reference names a config or, for a package with no build config, its directory.
const referenced = (root, reference, seen) => {
  const file = reference.endsWith(".json") ? reference : join(reference, "tsconfig.json");
  if (seen.has(file)) return seen;
  seen.add(file);
  const config = JSON.parse(readFileSync(join(root, file), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  for (const { path } of config.references ?? [])
    referenced(root, normalize(join(dirname(file), path)), seen);
  return seen;
};

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
      // The one root `tsc -b` (`pnpm typecheck`, bare `nx typecheck`): its tsbuildinfo
      // is the incremental cache, so Nx caches nothing. `nx sync` writes every project
      // reference first (ADR-150, 2026-10-10).
      const typecheck = {
        executor: "nx:run-commands",
        options: {
          cwd: "{workspaceRoot}",
          command: "GOMAXPROCS=2 GOMEMLIMIT=2GiB tsc -b --builders 1 --checkers 1",
        },
        cache: false,
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
      const targets = {
        typecheck,
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
