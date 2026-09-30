import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Project `workspace` (at dev/nx: no project owns the root) holds the repo-wide builds:
// `build:types` (`tsc -b`, declarations into the dist of every project the solution references,
// read from those references) plus `lint:rules` and `test:scripts`, which run the
// Makefile recipes as `lint:go` does. ADR-150 records why.
const solution = "tsconfig.build.json";

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
      const outputs = dirs.map((dir) => `{workspaceRoot}/${dir}/dist`);
      const target = {
        executor: "nx:run-commands",
        options: { cwd: "{workspaceRoot}", command: "tsc -b --builders 16 tsconfig.build.json" },
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
      const targets = {
        "build:types": target,
        "lint:rules": make("lint-rules-run", "uvx --version", everything),
        "test:scripts": make("test-scripts-run", "bats --version", [
          "{workspaceRoot}/dev/scripts/**/*",
        ]),
      };
      return [file, { projects: { "dev/nx": { name: "workspace", targets } } }];
    }),
];
