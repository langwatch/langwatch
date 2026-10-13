import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { memberPatterns } from "./workspace-members.mjs";

// Adds `lint` (oxlint over one project) to every workspace member, and
// `lint:types` (type-aware) to every TypeScript one, so no package.json carries
// either. Cache and inputs live in nx.json's targetDefaults; ADR-150 records why.
const members = memberPatterns(new URL("../..", import.meta.url).pathname);

const lint = { command: "oxlint --quiet --config .oxlintrc.jsonc {projectRoot}" };
const lintTypes = {
  command: "oxlint --quiet --type-aware --config .oxlintrc.jsonc {projectRoot}",
};

export const createNodes = [
  `{${members.join(",")}}/package.json`,
  (files, _options, context) =>
    files.map((file) => {
      const root = dirname(file);
      const typed = existsSync(join(context.workspaceRoot, root, "tsconfig.json"));
      const targets = typed ? { lint, "lint:types": lintTypes } : { lint };

      return [file, { projects: { [root]: { targets } } }];
    }),
];
