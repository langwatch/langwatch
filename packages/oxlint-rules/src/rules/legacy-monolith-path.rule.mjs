import { defineRule } from "../define-rule.mjs";

// `platform/app` was the monolith `apps/*` and `modules/*` replaced; `~/` and
// `@app/` were aliases that only resolved inside it. Nothing maps them now, so a
// stale path compiles until the first import of it. Spec: lint-legacy-monolith-path.

// Anchored so an application's own `src/platform/` and `cross-platform/` are left alone.
const LEGACY_ALIAS = /^(?:~|@app)\//;
const MONOLITH_PATH = /(?:^|[./])platform\/app(?:\/|$)/;

function isMonolithSpecifier(value) {
  return LEGACY_ALIAS.test(value) || MONOLITH_PATH.test(value);
}

export const legacyMonolithPathRule = defineRule({
  name: "legacy-monolith-path",
  kind: "problem",
  messages: {
    legacyMonolithPath: {
      what: "`{{name}}` names the deleted monolith.",
      why: "Nothing maps `~/*` or `@app/*` and `platform/` is gone, so the path resolves to nothing until something reaches the file.",
      fix: "Find where the code lives now by searching its basename under `modules/*/*/src`, `enterprise/modules/*/*/src`, `packages/*/src` and `apps/*/src`, then import it by that package's name.",
    },
  },
  create(context, file) {
    // A specifier is also a `Literal`; recording it keeps one import from reporting twice.
    const asSpecifier = new Set();

    const report = (node) =>
      context.report({ data: { name: node.value }, messageId: "legacyMonolithPath", node });

    const specifier = (source) => {
      if (source?.type !== "Literal") return;
      asSpecifier.add(source);
      if (typeof source.value === "string" && isMonolithSpecifier(source.value)) report(source);
    };

    const isRequire = (node) =>
      node.callee?.type === "Identifier" && node.callee.name === "require";

    return {
      ImportDeclaration: (node) => specifier(node.source),
      ImportExpression: (node) => specifier(node.source),
      ExportNamedDeclaration: (node) => specifier(node.source),
      ExportAllDeclaration: (node) => specifier(node.source),
      CallExpression(node) {
        if (isRequire(node)) specifier(node.arguments?.[0]);
      },
      // A bare `~/` string is a home directory, and a test may name the old paths as data.
      Literal(node) {
        if (asSpecifier.has(node) || file.isTest) return;
        if (typeof node.value === "string" && MONOLITH_PATH.test(node.value)) report(node);
      },
    };
  },
});
