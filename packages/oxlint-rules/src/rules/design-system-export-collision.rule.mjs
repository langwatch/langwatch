import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import { defineRule } from "../define-rule.mjs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const EXPORTED_VALUE =
  /\bexport\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_EXPORT = /\bexport\s*\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?\s*;/g;
const STAR_EXPORT = /\bexport\s*\*\s*from\s*["']([^"']+)["']\s*;/g;

const collisionIndexCache = new Map();

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function readManifest(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function sourceTarget(root, descriptor) {
  const target =
    typeof descriptor === "string"
      ? descriptor
      : (descriptor?.["langwatch-declaration-source"] ?? descriptor?.default);
  return typeof target === "string" ? resolve(root, target) : undefined;
}

function resolveLocalSource(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const unresolved = resolve(dirname(fromFile), specifier);
  const extension = extname(unresolved);
  const withoutExtension = extension ? unresolved.slice(0, -extension.length) : unresolved;
  const candidates = [
    unresolved,
    ...SOURCE_EXTENSIONS.map((suffix) => `${withoutExtension}${suffix}`),
    ...SOURCE_EXTENSIONS.map((suffix) => join(unresolved, `index${suffix}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function namedExports(clause) {
  const names = new Set();
  for (const part of clause.split(",")) {
    const declaration = part.trim();
    if (!declaration || declaration.startsWith("type ")) continue;
    const alias = declaration.split(/\s+as\s+/);
    const exported = alias.at(-1)?.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(exported ?? "")) names.add(exported);
  }
  return names;
}

function exportedValues(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return new Set();
  seen.add(file);

  const source = readFileSync(file, "utf8");
  const names = new Set([...source.matchAll(EXPORTED_VALUE)].map((match) => match[1]));
  for (const match of source.matchAll(NAMED_EXPORT)) {
    for (const name of namedExports(match[1])) names.add(name);
  }
  for (const match of source.matchAll(STAR_EXPORT)) {
    const target = resolveLocalSource(file, match[1]);
    if (!target) continue;
    for (const name of exportedValues(target, seen)) names.add(name);
  }
  return names;
}

function isComponentName(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
}

function designSystemComponents(cwd) {
  const root = join(cwd, "packages", "design-system");
  const manifest = readManifest(join(root, "package.json"));
  const components = new Map();
  for (const [subpath, descriptor] of Object.entries(manifest?.exports ?? {})) {
    const target = sourceTarget(root, descriptor);
    if (!target) continue;
    const importPath =
      subpath === "." ? "@langwatch/design-system" : `@langwatch/design-system${subpath.slice(1)}`;
    for (const name of exportedValues(target)) {
      if (!isComponentName(name)) continue;
      if (!components.has(name) || subpath !== ".") components.set(name, importPath);
    }
  }
  return components;
}

function addFeaturePackage(index, designComponents, root, feature) {
  const packageRoot = join(root, feature, "web");
  const manifest = readManifest(join(packageRoot, "package.json"));
  if (!manifest) return;

  for (const descriptor of Object.values(manifest.exports ?? {})) {
    const target = sourceTarget(packageRoot, descriptor);
    if (!target) continue;
    for (const name of exportedValues(target)) {
      const designSystemImport = designComponents.get(name);
      if (!designSystemImport) continue;
      const collisions = index.get(target) ?? [];
      collisions.push({ designSystemImport, featurePackage: manifest.name, name });
      index.set(target, collisions);
    }
  }
}

function collisionIndex(cwd) {
  const cached = collisionIndexCache.get(cwd);
  if (cached) return cached;

  const index = new Map();
  const designComponents = designSystemComponents(cwd);
  for (const root of [join(cwd, "modules"), join(cwd, "enterprise", "modules")]) {
    for (const feature of directories(root)) {
      addFeaturePackage(index, designComponents, root, feature);
    }
  }
  collisionIndexCache.set(cwd, index);
  return index;
}

function isFeatureWebSource(file) {
  return file.role === "browser" && file.sourcePath !== undefined;
}

export const designSystemExportCollisionRule = defineRule({
  name: "design-system-export-collision",
  kind: "problem",
  applies: isFeatureWebSource,
  messages: {
    duplicateComponent: {
      what: "`{{name}}` is exported by both `{{featurePackage}}` and `{{designSystemImport}}`.",
      why: "A generic UI component has one public owner.",
      fix: "Import `{{name}}` from `{{designSystemImport}}`, repoint every consumer, and delete this feature-package export.",
    },
  },
  create(context, file) {
    const collisions = collisionIndex(context.cwd).get(file.filename) ?? [];
    if (collisions.length === 0) return {};

    return {
      Program(node) {
        for (const collision of collisions) {
          context.report({
            node,
            messageId: "duplicateComponent",
            data: collision,
          });
        }
      },
    };
  },
});
