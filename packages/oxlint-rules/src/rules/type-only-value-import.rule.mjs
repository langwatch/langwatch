import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineRule } from "../define-rule.mjs";

// Importing an interface or type alias as a value is a syntax error at
// runtime under ESM: the target module never emits that export, so Node
// throws `SyntaxError: does not provide an export named`. The fix is always
// the same one-word change, so this is worth catching before it ships.

const EXPORT_TYPE = /export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b/g;
const EXPORT_VALUE =
  /export\s+(?:declare\s+)?(?:class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)\b/g;
const CANDIDATE_EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

const exportsCache = new Map();

function exportKindsOf(absolutePath) {
  if (exportsCache.has(absolutePath)) return exportsCache.get(absolutePath);

  let result;
  if (!existsSync(absolutePath)) {
    result = undefined;
  } else {
    const source = readFileSync(absolutePath, "utf8");
    const typeOnly = new Set();
    const value = new Set();
    for (const match of source.matchAll(EXPORT_TYPE)) typeOnly.add(match[1]);
    for (const match of source.matchAll(EXPORT_VALUE)) value.add(match[1]);
    result = { typeOnly, value };
  }

  exportsCache.set(absolutePath, result);
  return result;
}

function resolveRelativeTarget(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  for (const suffix of CANDIDATE_EXTENSIONS) {
    const candidate = base.endsWith(suffix) ? base : `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export const typeOnlyValueImportRule = defineRule({
  name: "type-only-value-import",
  kind: "problem",
  messages: {
    valueImportOfType: {
      what: "`{{name}}` is imported as a value here, but its declaration in `{{specifier}}` is a type or interface.",
      fix: "Import it with `import type` instead.",
    },
  },
  create(context, file) {
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const specifier = node.source.value;
        if (typeof specifier !== "string" || !specifier.startsWith(".")) return;

        const target = resolveRelativeTarget(file.filename, specifier);
        if (!target) return;
        const kinds = exportKindsOf(target);
        if (!kinds) return;

        for (const importSpecifier of node.specifiers) {
          if (importSpecifier.type !== "ImportSpecifier") continue;
          if (importSpecifier.importKind === "type") continue;
          const name =
            importSpecifier.imported.type === "Identifier"
              ? importSpecifier.imported.name
              : undefined;
          if (!name) continue;
          if (kinds.typeOnly.has(name) && !kinds.value.has(name)) {
            context.report({
              node: importSpecifier,
              messageId: "valueImportOfType",
              data: { name, specifier },
            });
          }
        }
      },
    };
  },
});
