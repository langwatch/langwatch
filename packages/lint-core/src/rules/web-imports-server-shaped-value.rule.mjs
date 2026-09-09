import { defineRule } from "../define-rule.mjs";

/**
 * Browser code may not VALUE-import a package whose declarations are the
 * server's. A type import is free — types are erased and, more to the point,
 * the browser program never loads the graph behind them.
 *
 * The measured cost is not hypothetical. `better-auth/react` in one browser
 * module put 576 declaration files into `apps/ui`, 251 of them kysely: a SQL
 * query builder, in the program for a page. The trimmed contract in
 * `types/browser/` is why the two client entrypoints below stay allowed —
 * everything else on this list has no browser half at all.
 */

const SERVER_SHAPED = [
  "kysely",
  "@clickhouse/client",
  "@clickhouse/client-web",
  "@prisma/client",
  "@langwatch/prisma-client",
  "better-auth",
  "@better-auth",
];

/**
 * The browser entrypoints of an otherwise server-shaped package. `paths` in
 * the browser tsconfigs points the checker at `types/browser/` for these, so
 * naming one costs the program nothing.
 */
const BROWSER_ENTRYPOINTS = new Set([
  "better-auth/react",
  "better-auth/client",
  "better-auth/client/plugins",
  "@better-auth/passkey/client",
]);

function serverShapedPackage(specifier) {
  if (BROWSER_ENTRYPOINTS.has(specifier)) return undefined;
  return SERVER_SHAPED.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function isBrowserSource(workspacePath) {
  const featureWeb = /^(?:enterprise\/)?modules\/[^/]+\/web\/src\//.test(workspacePath);
  const application = /^apps\/ui\/src\//.test(workspacePath);
  return featureWeb || application;
}

function importedSpecifier(node) {
  if (node.type === "ImportExpression") {
    return node.source?.type === "Literal" ? node.source.value : undefined;
  }
  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

/** `import type { X }` and `import { type X }` both erase; neither counts. */
function isValueImport(node) {
  if (node.importKind === "type" || node.exportKind === "type") return false;
  const specifiers = node.specifiers ?? [];
  if (specifiers.length === 0) return true;
  return specifiers.some((specifier) => (specifier.importKind ?? specifier.exportKind) !== "type");
}

export const webImportsServerShapedValueRule = defineRule({
  name: "web-imports-server-shaped-value",
  kind: "problem",
  messages: {
    serverShaped: {
      what: "A browser module value-imports `{{name}}`, whose declarations are the server's and pull a database graph into the browser program.",
      why: "Loading declaration files is the largest bucket in a type-check, and this class of import is invisible in the bundle.",
      fix: "Import it as a type only, or reach the capability through a first-party module that the browser already owns.",
    },
  },
  applies: (file) => isBrowserSource(file.workspacePath) && file.isProduction,
  create(context) {
    const check = (node) => {
      if (!isValueImport(node)) return;
      const specifier = importedSpecifier(node);
      if (typeof specifier !== "string") return;
      const name = serverShapedPackage(specifier);
      if (name === undefined) return;
      context.report({ node, messageId: "serverShaped", data: { name: specifier } });
    };

    return {
      ImportDeclaration: check,
      ImportExpression: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
});
