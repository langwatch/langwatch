import { defineRule } from "../define-rule.mjs";

// A barrel that re-exports a symbol under a second name is a compatibility
// shim: two names now resolve to the same thing, and a reader (or a rename
// tool) cannot tell which one is the real one. Rename the symbol itself
// instead of adding an alias on the way out.

const BARREL_FILE = /(?:^|\/)index\.[cm]?[jt]sx?$/;

function isGoverned(workspacePath) {
  return BARREL_FILE.test(workspacePath);
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
          if (specifier.type !== "ExportSpecifier") continue;
          const local =
            specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
          const exported =
            specifier.exported.type === "Identifier"
              ? specifier.exported.name
              : specifier.exported.value;
          if (local && exported && local !== exported) {
            context.report({
              node: specifier,
              messageId: "aliasReexport",
              data: { exported, local },
            });
          }
        }
      },
    };
  },
});
