import { defineRule } from "../define-rule.mjs";

// Dynamic import() hides dependencies. Allowed only: CLI startup path (~30ms
// cold start), web package entry files, and UI routes/drawers (code-split).

const GENERATED = /(?:^|\/)(?:dist|node_modules|generated)\/|\.generated\.[cm]?tsx?$/;
const CLI_STARTUP = /^sdks\/typescript\/src\/cli\//;
const CLI_TSUP_CONFIG = /^sdks\/typescript\/tsup\.config\.ts$/;
const WEB_PACKAGE_ENTRY = /^(?:enterprise\/)?modules\/[^/]+\/web\/src\/[^/]+\.ts$/;
const UI_APPLICATION = /^apps\/ui\/src\//;

function isExempt(workspacePath) {
  return (
    CLI_STARTUP.test(workspacePath) ||
    CLI_TSUP_CONFIG.test(workspacePath) ||
    WEB_PACKAGE_ENTRY.test(workspacePath) ||
    UI_APPLICATION.test(workspacePath)
  );
}

function isGoverned(file) {
  return !GENERATED.test(file.workspacePath) && !isExempt(file.workspacePath);
}

export const noInlineDynamicImportRule = defineRule({
  name: "no-inline-dynamic-import",
  kind: "problem",
  messages: {
    inlineDynamicImport: {
      what: "`import(...)` is used inline here.",
      why: "A dynamic import hides a dependency the reader expects to find as a top-level import.",
      fix: "Use a top-level `import` / `import type` statement instead.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      ImportExpression(node) {
        context.report({ node, messageId: "inlineDynamicImport" });
      },
    };
  },
});
