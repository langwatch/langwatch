import { defineRule } from "../define-rule.mjs";

// Dynamic import() hides dependencies. Allowed only: CLI startup path (~30ms
// cold start), web package entry files, and UI routes/drawers (code-split).

const GENERATED = /(?:^|\/)(?:dist|node_modules|generated)\/|\.generated\.[cm]?tsx?$/;
const CLI_STARTUP = /^sdks\/typescript\/src\/cli\//;
// The published `langwatch-mcp-server` binary, which an editor or agent starts
// per session. It registers ~100 tools and a session calls a handful, so each
// handler -- and the 2,027-line generated evaluator catalogue behind one of
// them -- is reached from inside the callback that needs it. That keeps the
// boot graph at 21 modules. Same trade as the CLI above, same kind of artefact,
// and pinned the same way: src/__tests__/create-mcp-server-boot.unit.test.ts
// walks the static graph and fails if a handler moves onto the boot path.
const MCP_SERVER_STARTUP = /^mcp\/typescript\/src\//;
const CLI_TSUP_CONFIG = /^sdks\/typescript\/tsup\.config\.ts$/;
const WEB_PACKAGE_ENTRY = /^(?:enterprise\/)?modules\/[^/]+\/browser\/src\/[^/]+\.ts$/;
const UI_APPLICATION = /^apps\/ui\/src\//;

function isExempt(workspacePath) {
  return (
    CLI_STARTUP.test(workspacePath) ||
    MCP_SERVER_STARTUP.test(workspacePath) ||
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
