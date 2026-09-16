import { defineRule } from "../define-rule.mjs";

// `platform/app` was the monolith that `apps/*` and `modules/*` replaced, and
// `~/` was the alias that only resolved inside it. No tsconfig maps `~/*` now,
// so a stale path resolves to nothing and TypeScript says so only when something
// reaches the file - which is how a moved test or a half-finished port keeps
// compiling until the first import of it.

// `platform/app` is the monolith itself, anchored so the legitimate nested
// `apps/api/src/platform/config/` is left alone, and `cross-platform/` with it.
const LEGACY_PATH = /^~\//;
const MONOLITH_PATH = /(?:^|[./])platform\/app(?:\/|$)/;

export const legacyMonolithPathRule = defineRule({
  name: "legacy-monolith-path",
  kind: "problem",
  messages: {
    legacyMonolithPath: {
      what: "`{{name}}` names the deleted monolith.",
      why: "Nothing maps `~/*` and `platform/` is gone, so the path resolves to nothing until something reaches the file.",
      fix: "Find where the code lives now by searching its basename across `modules/*/{contract,server,web}/src`, `packages/*/src` and `apps/*/src`, then re-point this specifier at that package.",
    },
  },
  create(context, file) {
    // A module specifier IS a string literal, so the `Literal` visitor below
    // sees the same node again. The parent is visited first, so recording it
    // here is what keeps one stale import from being reported twice.
    const asSpecifier = new Set();

    const reportPath = (node, value) => {
      if (typeof value !== "string") return false;
      if (LEGACY_PATH.test(value) || MONOLITH_PATH.test(value)) {
        context.report({ data: { name: value }, messageId: "legacyMonolithPath", node });
        return true;
      }
      return false;
    };

    const specifier = (node) => {
      if (!node?.source) return;
      asSpecifier.add(node.source);
      reportPath(node.source, node.source.value);
    };

    return {
      ImportDeclaration: specifier,
      ImportExpression: specifier,
      ExportNamedDeclaration: specifier,
      ExportAllDeclaration: specifier,

      CallExpression(node) {
        if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return;
        const first = node.arguments?.[0];
        if (first?.type !== "Literal") return;
        asSpecifier.add(first);
        reportPath(first, first.value);
      },

      // A string that is not a module specifier. `~/` is NOT checked here: in
      // specifier position it is the monolith's alias, but a bare string is a
      // home directory, and `~/.codex/hooks.json` in the CLI is not a stale
      // import. `platform/app` still is, because nothing else is called that -
      // except in a test, which is the one place the old paths must be written
      // down: the CI path-filter suites keep them under `wasFiles` precisely to
      // prove the monolith is gone, and telling those to re-point a specifier
      // asks for something that does not exist.
      Literal(node) {
        if (asSpecifier.has(node)) return;
        if (file.isTest) return;
        if (typeof node.value !== "string") return;
        if (MONOLITH_PATH.test(node.value)) {
          context.report({ data: { name: node.value }, messageId: "legacyMonolithPath", node });
        }
      },
    };
  },
});
