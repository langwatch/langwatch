import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Adds `lint:types` (type-aware oxlint over one project) to every TypeScript
// workspace member, so no package.json carries it. Cache and inputs live in
// nx.json's targetDefaults; ADR-150 records why.
const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
const block = workspace.match(/^packages:\n((?:[ \t]+-.*\n)+)/m)?.[1] ?? "";
const members = [...block.matchAll(/-\s+(\S+)/g)].map((m) => m[1]);

const lintTypes = {
  command: "oxlint --quiet --type-aware --config .oxlintrc.jsonc {projectRoot}",
};

export const createNodes = [
  `{${members.join(",")}}/package.json`,
  (files, _options, context) =>
    files.flatMap((file) => {
      const root = dirname(file);
      if (!existsSync(join(context.workspaceRoot, root, "tsconfig.json"))) return [];
      return [[file, { projects: { [root]: { targets: { "lint:types": lintTypes } } } }]];
    }),
];
