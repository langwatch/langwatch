import { defineRule } from "../define-rule.mjs";

// A barrel that re-exports a symbol under a second name is a compatibility
// shim: two names now resolve to the same thing, and a reader (or a rename
// tool) cannot tell which one is the real one. Rename the symbol itself
// instead of adding an alias on the way out.

const BARREL_FILE = /(?:^|\/)index\.[cm]?[jt]sx?$/;

function isGoverned(workspacePath) {
  return BARREL_FILE.test(workspacePath);
}

function nameOf(node) {
  return node.type === "Identifier" ? node.name : node.value;
}

/** The `{ local, exported }` pair when a specifier renames on the way out. */
function aliasOf(specifier) {
  if (specifier.type !== "ExportSpecifier") return undefined;
  const local = nameOf(specifier.local);
  const exported = nameOf(specifier.exported);
  // A default export has no name to rename; naming it on the way out is the only spelling.
  if (local === "default") return undefined;
  if (!local || !exported || local === exported) return undefined;
  return { exported, local };
}

export const noAliasReexportRule = defineRule({
  name: "no-alias-reexport",
  kind: "problem",
  messages: {
    aliasReexport: {
      what: "`{{local}}` is re-exported here as `{{exported}}`.",
      fix: "Rename `{{local}}` to `{{exported}}` with tslsp-cli and export it under one name.",
    },
  },
  create(context, file) {
    if (!isGoverned(file.workspacePath)) return {};

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration) return;
        for (const specifier of node.specifiers) {
          const alias = aliasOf(specifier);
          if (alias) context.report({ node: specifier, messageId: "aliasReexport", data: alias });
        }
      },
    };
  },
});
