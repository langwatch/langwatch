import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildInfoOutsideDist, declarationOutputs, referenced } from "./typecheck-plugin.mjs";

// Project `workspace` (at dev/nx: no project owns the root) holds the repo-wide builds:
// `build:types` (`tsc -b` over every module contract's build config, declarations into the dist of
// every project those reference) plus `lint:rules` and `test:scripts`, which run the Makefile
// recipes as `lint:go` does. Keyed on nx.json, which every workspace has. ADR-150 records why.
const contracts = "modules/*/contract/tsconfig.build.json";

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
      // `pnpm typecheck:src`, the local default: one root `tsc -b` without the test programs,
      // cached on the sources of what it reads and of the files its dependencies generate,
      // never on dist contents. `pnpm typecheck` is the per-project `typecheck` targets
      // (typecheck-plugin.mjs). ADR-150, amendments 2026-10-10 and 2026-11-27.
      const solution = referenced(workspaceRoot, "tsconfig.json", new Set());
      const solutionDirs = [...new Set([...solution].map(dirname))].filter((dir) => dir !== ".");
      const prepared = [
        "@langwatch/prisma-client:prisma:generate",
        ...["langwatch", "@langwatch/mcp-server", "@langwatch/ksuid", "@langwatch/mail"].map(
          (project) => `${project}:build`,
        ),
      ];
      const sourceTypecheck = {
        executor: "nx:run-commands",
        options: { cwd: "{workspaceRoot}", command: "node dev/scripts/typecheck-src.mjs" },
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
        dependsOn: prepared,
      };
      // `pnpm lint` over a resolved scope (dev/nx/lint.mjs passes it as arguments, which
      // Nx hashes); the plugin rules read files beyond the linted ones, so it hashes the
      // tree. The type-aware lint is per project (`lint:types`, after its `typecheck`).
      const lintTree = {
        executor: "nx:run-commands",
        options: { cwd: "{workspaceRoot}", command: "node dev/nx/lint.mjs" },
        cache: true,
        inputs: [...everything, { env: "LANGWATCH_SKILLS_RENDER" }, { runtime: "node --version" }],
        outputs: [],
        dependsOn: prepared,
      };
      const targets = {
        "lint:tree": lintTree,
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
