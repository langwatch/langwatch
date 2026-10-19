/**
 * Wraps every `import()` in our code in `importChunk`, so a dropped chunk is retried where
 * the module itself is returned: a loader that reshapes it (`{ default: m.Thing }`) cannot
 * be retried by address. Spec: specs/navigation/chunk-load-retry.feature
 */
import path from "node:path";

import type { Plugin } from "vite";

/** The global name the wrapped calls use; unlikely to meet a name in our code. */
export const IMPORT_CHUNK_BINDING = "__lwImportChunk";

type Located = { type: string; start: number; end: number };

/** Every `import()` expression in an ESTree program, innermost included. */
function dynamicImports(node: unknown, found: Located[] = []): Located[] {
  if (Array.isArray(node)) {
    for (const child of node) dynamicImports(child, found);
    return found;
  }
  if (typeof node !== "object" || node === null) return found;
  const candidate = node as Partial<Located>;
  if (candidate.type === "ImportExpression") found.push(candidate as Located);
  for (const value of Object.values(node)) dynamicImports(value, found);
  return found;
}

/**
 * The module with each `import(x)` turned into `importChunk(() => import(x))`, and the
 * helper's import appended (not prepended, so line numbers in the source map hold).
 */
export function wrapDynamicImports({
  code,
  program,
  helperPath,
}: {
  code: string;
  program: unknown;
  helperPath: string;
}): string | null {
  const found = dynamicImports(program);
  if (found.length === 0) return null;
  const edits = found.flatMap(({ start, end }) => [
    { at: start, text: `${IMPORT_CHUNK_BINDING}(() => ` },
    { at: end, text: ")" },
  ]);
  let wrapped = code;
  // From the end, so earlier offsets stay valid.
  for (const { at, text } of edits.toSorted((a, b) => b.at - a.at)) {
    wrapped = wrapped.slice(0, at) + text + wrapped.slice(at);
  }
  const helper = JSON.stringify(helperPath);
  return `${wrapped}\nimport { importChunk as ${IMPORT_CHUNK_BINDING} } from ${helper};\n`;
}

/** Our source only: dependencies keep their own loading, and the helper must not wrap itself. */
export function wrapsImportsIn({ id, repoRoot }: { id: string; repoRoot: string }): boolean {
  const file = id.split("?")[0] ?? id;
  if (!file.startsWith(repoRoot) || /[\\/]node_modules[\\/]/.test(file)) return false;
  if (/[\\/]packages[\\/]browser-host[\\/]src[\\/](chunk-refetch|navigation)\.ts$/.test(file)) {
    return false;
  }
  return /\.(m?[jt]sx?)$/.test(file);
}

/** Build only: the dev server serves modules one by one, with no chunks to drop. */
export function chunkImportRetry({ repoRoot }: { repoRoot: string }): Plugin {
  const helperPath = path.join(repoRoot, "packages/browser-host/src/navigation.ts");
  return {
    name: "langwatch:chunk-import-retry",
    apply: "build",
    transform(code, id) {
      if (!code.includes("import(") || !wrapsImportsIn({ id, repoRoot })) return null;
      const wrapped = wrapDynamicImports({ code, program: this.parse(code), helperPath });
      return wrapped === null ? null : { code: wrapped, map: null };
    },
  };
}
