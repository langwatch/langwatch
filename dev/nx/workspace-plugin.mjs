import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Project `workspace` (at dev/nx: no project owns the root) holds the repo-wide builds:
// `build:types` (`tsc -b`, declarations into the dist of every project the solution references,
// read from those references) plus `lint:rules` and `test:scripts`, which run the
// Makefile recipes as `lint:go` does. ADR-150 records why.
const solution = "tsconfig.build.json";

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

const referenced = (root, file, seen) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  const config = JSON.parse(readFileSync(join(root, file), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  for (const { path } of config.references ?? [])
    referenced(root, normalize(join(dirname(file), path)), seen);
  return seen;
};

export const createNodes = [
  solution,
  (files, _options, { workspaceRoot }) =>
    files.map((file) => {
      const dirs = [...referenced(workspaceRoot, file, new Set())]
        .filter((f) => f !== file)
        .map(dirname);
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
          command: "GOMEMLIMIT=2GiB tsc -b --builders 1 tsconfig.build.json",
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
      // is the incremental cache, so Nx caches nothing (ADR-150, 2026-10-10).
      const typecheck = {
        executor: "nx:run-commands",
        options: {
          cwd: "{workspaceRoot}",
          command: "GOMEMLIMIT=2GiB tsc -b --builders 1 --checkers 1",
        },
        cache: false,
        dependsOn: [
          "@langwatch/prisma-client:prisma:generate",
          ...["langwatch", "@langwatch/mcp-server", "@langwatch/ksuid", "@langwatch/mail"].map(
            (project) => `${project}:build`,
          ),
        ],
      };
      const targets = {
        typecheck,
        "build:types": target,
        "lint:rules": make("lint-rules-run", "uvx --version", everything),
        "test:scripts": make("test-scripts-run", "bats --version", [
          "{workspaceRoot}/dev/scripts/**/*",
        ]),
      };
      return [file, { projects: { "dev/nx": { name: "workspace", targets } } }];
    }),
];
