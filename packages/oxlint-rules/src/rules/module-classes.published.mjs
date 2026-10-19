import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { entrySourcePaths } from "../../grammar/feature-layout-policy.mjs";
import { parseFile } from "../parse.mjs";

// The names an opted-in framework package publishes, read from the `export ... from`
// lines of the entry files its `exports` names (ADR-181 decision 3). A published class
// keeps its name and its constructor; `export *` is followed into its target.

const publishedCache = new Map();

function resolveRelative({ from, specifier }) {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(from), specifier);
  const stem = target.replace(/\.[cm]?js$/, "");
  const candidates = [target, `${stem}.ts`, `${stem}.tsx`, join(target, "index.ts")];

  return candidates.find(
    (candidate) =>
      /\.[cm]?tsx?$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function declaredName(declaration) {
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.map((item) => item.id?.name);
  }
  return [declaration.id?.name];
}

function specifierNames(statement) {
  return statement.specifiers.map((item) => item.local?.name ?? item.local?.value);
}

function addStatementExports({ filename, statement, names, visited }) {
  if (statement.type === "ExportAllDeclaration") {
    const target = resolveRelative({ from: filename, specifier: statement.source.value });
    if (target) collectExports({ filename: target, names, visited });
    return;
  }
  if (statement.type !== "ExportNamedDeclaration") return;
  const found = statement.declaration
    ? declaredName(statement.declaration)
    : specifierNames(statement);
  for (const name of found) if (name) names.add(name);
}

/** Every name a file exports, following `export *` and leaving named re-exports as names. */
function collectExports({ filename, names, visited }) {
  if (visited.has(filename)) return;
  visited.add(filename);
  const { program } = parseFile(filename);
  for (const statement of program.body) {
    addStatementExports({ filename, statement, names, visited });
  }
}

function readPublished(root) {
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) return new Set();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const names = new Set();
  const visited = new Set();
  for (const entry of entrySourcePaths(manifest.exports)) {
    const filename = join(root, "src", entry);
    if (existsSync(filename)) collectExports({ filename, names, visited });
  }

  return names;
}

/**
 * The names the package holding `file` publishes through its entry files.
 * @param {{ cwd: string, file: { relative: string, workspacePath: string } }} input
 * @returns {Set<string>}
 */
export function publishedNamesOf({ cwd, file }) {
  const packagePath = file.workspacePath.slice(0, -file.relative.length);
  const root = join(cwd, packagePath);
  if (!publishedCache.has(root)) publishedCache.set(root, readPublished(root));

  return publishedCache.get(root);
}
