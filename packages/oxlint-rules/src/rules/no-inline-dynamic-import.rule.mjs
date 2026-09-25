import { defineRule } from "../define-rule.mjs";

// Dynamic import() hides dependencies. Allowed: the CLI and MCP startup paths,
// the Google DLP channel, web package entry files, UI routes/drawers,
// `lazy(() => import(...))`, and tests, where an import after `vi.mock` is what
// makes the mock apply.

const GENERATED = /(?:^|\/)(?:dist|node_modules|generated)\/|\.generated\.[cm]?tsx?$/;
const CLI_STARTUP = /^sdks\/typescript\/src\/cli\//;
// Each MCP tool handler loads inside its callback to keep the boot graph small;
// pinned by mcp/typescript/src/__tests__/create-mcp-server-boot.unit.test.ts.
const MCP_SERVER_STARTUP = /^mcp\/typescript\/src\//;
// The Google DLP SDK loads on first inspection, never at boot; pinned by
// modules/data-privacy/process/src/channels/http/__tests__/http.google-dlp.channel.unit.test.ts.
const GOOGLE_DLP_CHANNEL =
  /^modules\/data-privacy\/process\/src\/channels\/http\/http\.google-dlp\.channel\.ts$/;
const CLI_TSUP_CONFIG = /^sdks\/typescript\/tsup\.config\.ts$/;
const WEB_PACKAGE_ENTRY = /^(?:enterprise\/)?modules\/[^/]+\/browser\/src\/[^/]+\.ts$/;
const UI_APPLICATION = /^apps\/ui\/src\//;

function isExempt(workspacePath) {
  return (
    CLI_STARTUP.test(workspacePath) ||
    MCP_SERVER_STARTUP.test(workspacePath) ||
    GOOGLE_DLP_CHANNEL.test(workspacePath) ||
    CLI_TSUP_CONFIG.test(workspacePath) ||
    WEB_PACKAGE_ENTRY.test(workspacePath) ||
    UI_APPLICATION.test(workspacePath)
  );
}

function isGoverned(file) {
  return !file.isTest && !GENERATED.test(file.workspacePath) && !isExempt(file.workspacePath);
}

const LAZY = /^lazy$/;

function isLazyCallee(callee) {
  if (callee.type === "Identifier") return LAZY.test(callee.name);

  return callee.type === "MemberExpression" && !callee.computed && LAZY.test(callee.property.name);
}

/** `lazy(() => import("./x"))`, also through a `.then(...)` that picks the export. */
function isLazyLoader(node) {
  let current = node;
  while (
    current.parent?.type === "MemberExpression" &&
    current.parent.object === current &&
    current.parent.parent?.type === "CallExpression" &&
    current.parent.parent.callee === current.parent
  ) {
    current = current.parent.parent;
  }
  const loader = current.parent;
  if (loader?.type !== "ArrowFunctionExpression" || loader.body !== current) return false;

  return loader.parent?.type === "CallExpression" && isLazyCallee(loader.parent.callee);
}

export const noInlineDynamicImportRule = defineRule({
  name: "no-inline-dynamic-import",
  kind: "problem",
  messages: {
    inlineDynamicImport: {
      what: "`import(...)` is used inline here.",
      why: "A dynamic import hides a dependency the reader expects to find as a top-level import.",
      fix: "Use a top-level `import` / `import type` statement instead; a code-split component loads through `lazy(() => import(...))`.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    return {
      ImportExpression(node) {
        if (isLazyLoader(node)) return;
        context.report({ node, messageId: "inlineDynamicImport" });
      },
    };
  },
});
