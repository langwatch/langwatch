import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { defineRule } from "../define-rule.mjs";

// A move leaves every relative specifier that named the old path behind, and
// a stale `dist/*.d.ts` keeps `tsc` and the editor green over it. Resolving
// the specifier against the disk is the one check a build artefact cannot fool.

/** The bare specifier first, so `./x.css` costs one `stat`; `/index.*` last, being rarest. */
const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.mts",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
];

/** `./x.js` is how ESM names `./x.ts`; the same holds for the other pairs. */
const JS_TO_TS = new Map([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

const EXTENSION = /\.[cm]?[jt]sx?$/;

const resolutionCache = new Map();

function isFile(path) {
  const stat = statSync(path, { throwIfNoEntry: false });

  return stat !== undefined && stat.isFile();
}

function resolvesOnDisk(target) {
  if (CANDIDATE_SUFFIXES.some((suffix) => isFile(`${target}${suffix}`))) return true;

  const extension = target.match(EXTENSION)?.[0];
  const stem = extension ? target.slice(0, -extension.length) : target;
  return (JS_TO_TS.get(extension) ?? []).some((replacement) => isFile(`${stem}${replacement}`));
}

function resolves(target) {
  const cached = resolutionCache.get(target);
  if (cached !== undefined) return cached;

  const found = resolvesOnDisk(target);
  resolutionCache.set(target, found);

  return found;
}

/** Drops the memoised disk answers. Only the fixture harness needs this. */
export function resetUnresolvedImportCache() {
  resolutionCache.clear();
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** A relative specifier without a build-tool suffix (`?raw`, `?worker`) is a file on disk. */
function relativeSpecifier(node) {
  const specifier = staticString(node);
  if (!specifier?.startsWith(".") || specifier.includes("?")) return undefined;

  return specifier;
}

function isRequireCall(node) {
  return (
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  );
}

export const unresolvedRelativeImportRule = defineRule({
  name: "unresolved-relative-import",
  kind: "problem",
  messages: {
    unresolved: {
      what: "`{{specifier}}` names no file on disk.",
      why: "A stale `dist/*.d.ts` keeps diagnostics green, so only a test run finds it.",
      fix:
        "Point it at the file's new path, or delete the line if the file is gone; a move " +
        "leaves these in batches, so resolve the whole file in one pass.",
    },
  },
  create(context, file) {
    const from = dirname(file.filename);

    const check = (sourceNode) => {
      const specifier = relativeSpecifier(sourceNode);
      if (!specifier || resolves(resolve(from, specifier))) return;

      context.report({ node: sourceNode, messageId: "unresolved", data: { specifier } });
    };

    return {
      ExportAllDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ImportDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        if (isRequireCall(node)) check(node.arguments[0]);
      },
    };
  },
});
