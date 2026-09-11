import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A codemod moves a file, the barrel keeps pointing at the path it left, and
// nothing says so: `tsc` reads a stale `dist/*.d.ts` and stays green, the
// editor resolves through the same declaration, and the first honest answer
// comes from a test run. Resolving the specifier against the disk is the one
// check that cannot be fooled by a build artefact.

/**
 * The candidates a relative specifier may resolve to. The bare specifier is
 * first so `./x.css` and `./x.json` cost one `stat`; the `/index.*` tail is
 * last because it is the rarest.
 */
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
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (isFile(`${target}${suffix}`)) return true;
  }

  const extension = target.match(EXTENSION)?.[0];
  const stem = extension ? target.slice(0, -extension.length) : target;
  for (const replacement of JS_TO_TS.get(extension) ?? []) {
    const rewritten = `${stem}${replacement}`;
    if (isFile(rewritten)) return true;
  }

  return false;
}

/** Memoised on the absolute target, so a barrel of 40 lines costs 40 lookups once. */
function resolves(target) {
  const cached = resolutionCache.get(target);
  if (cached !== undefined) return cached;

  const found = resolvesOnDisk(target);
  resolutionCache.set(target, found);

  return found;
}

/** Drops the memoised disk answers. Only the fixture harness needs this. */
export function resetDanglingResolutionCache() {
  resolutionCache.clear();
}

function specifierOf(node) {
  const source = node.source;
  if (source?.type !== "Literal" || typeof source.value !== "string") return undefined;
  const specifier = source.value;
  // A relative specifier is the only one this rule can answer for: a package
  // specifier resolves through node_modules and an alias through tsconfig.
  if (!specifier.startsWith(".")) return undefined;
  // A build-tool suffix (`?raw`, `?url`, `?worker`) names something the
  // bundler makes, not a file on disk.
  if (specifier.includes("?")) return undefined;

  return specifier;
}

export const danglingBarrelExportRule = defineRule({
  name: "dangling-barrel-export",
  kind: "problem",
  messages: {
    danglingReexport: {
      what: "`{{specifier}}` is re-exported here but no file of that name exists.",
      fix: "Point the re-export at the file's new path, or delete the line if the file is gone.",
      why: "A stale `dist/*.d.ts` keeps diagnostics green, so only a test run finds it.",
    },
    danglingImport: {
      what: "`{{specifier}}` is imported here but no file of that name exists.",
      fix: "Point the import at the file's new path, or delete the line if the file is gone.",
      why: "A stale `dist/*.d.ts` keeps diagnostics green, so only a test run finds it.",
    },
  },
  create(context, file) {
    if (
      isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "dangling-barrel-export" })
    ) {
      return {};
    }

    const from = dirname(file.filename);

    const check = (node, messageId) => {
      const specifier = specifierOf(node);
      if (!specifier) return;
      const target = resolve(from, specifier);
      if (resolves(target)) return;

      context.report({ node: node.source, messageId, data: { specifier } });
    };

    return {
      ExportAllDeclaration(node) {
        check(node, "danglingReexport");
      },
      ExportNamedDeclaration(node) {
        check(node, "danglingReexport");
      },
      ImportDeclaration(node) {
        check(node, "danglingImport");
      },
    };
  },
});
