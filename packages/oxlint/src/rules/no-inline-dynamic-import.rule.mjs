import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A dynamic `import(...)` hides a dependency the reader expects to find as a
// top-level import, and everywhere but three seams it buys nothing a static
// import doesn't already give for free. The CLI startup path is the one
// place it is load-bearing: lazy `import()` there is what keeps commander,
// chalk, zod, js-yaml, the command modules and the command catalogue off the
// boot graph, pinned at ~30ms cold start by its own boot-graph test. The
// other two are the lazy-loading seams a browser app is built around: a web
// package's own top-level entry file, and the UI application, which is a
// Vite SPA whose routes and drawers are code-split by design.

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
    if (
      isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "no-inline-dynamic-import" })
    ) {
      return {};
    }

    return {
      ImportExpression(node) {
        context.report({ node, messageId: "inlineDynamicImport" });
      },
    };
  },
});
