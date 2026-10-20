import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";

import { configDefaults, type ViteUserConfig } from "vitest/config";

import { mocksModules } from "./mocks-modules.ts";

const GLOB_SPECIAL = /[\\*?[\]{}()!+@]/g;
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
const INDEX_FILES = ["/index.ts", "/index.tsx"];

type TestOptions = NonNullable<ViteUserConfig["test"]>;

/**
 * Isolates only the files that mock modules, or reach a file that does, and
 * lets the rest share a registry per worker. See testing-speed.md for why.
 */
export function splitIsolationByMocking({
  test,
  root,
  alsoIsolate = [],
}: {
  test: TestOptions;
  root: string;
  alsoIsolate?: string[];
}): TestOptions {
  if (test.isolate !== true) return test;
  const base = test.dir === undefined ? root : join(root, test.dir);
  const { include = configDefaults.include, ...inherited } = test;
  const exclude = test.exclude ?? configDefaults.exclude;
  const files = globSync(include, {
    cwd: base,
    exclude: (entry) => /(^|\/)(node_modules|dist)$/.test(String(entry)),
  })
    .filter((file) => !exclude.some((pattern) => matchesGlob(file, pattern)))
    .toSorted();
  const named = (file: string) =>
    alsoIsolate.some((pattern) => matchesGlob(relative(root, file), pattern));
  const needsIsolation = reachesIsolation(named);
  const isolated = files.filter((file) => needsIsolation(join(base, file)));
  if (isolated.length === 0 || isolated.length === files.length) return test;

  const asGlobs = isolated.map((file) => file.replace(GLOB_SPECIAL, "\\$&"));
  // `extends: true` concatenates arrays, so `include` stays off the root: left
  // there, the isolated project would collect every file as well as its own.
  return {
    ...inherited,
    projects: [
      {
        extends: true,
        test: { name: "shared-modules", isolate: false, include, exclude: [...exclude, ...asGlobs] },
      },
      { extends: true, test: { name: "isolated", isolate: true, include: asGlobs } },
    ],
  };
}

/**
 * Whether a file or its relative imports mock modules or are `named`. Only a
 * `true` verdict is shared across test files: mid-cycle, a file can look clean.
 */
function reachesIsolation(named: (file: string) => boolean): (file: string) => boolean {
  const reaches = new Set<string>();
  const texts = new Map<string, string>();
  const textOf = (file: string) => {
    let text = texts.get(file);
    if (text === undefined) {
      text = readFileSync(file, "utf8");
      texts.set(file, text);
    }
    return text;
  };
  return (entry) => {
    const seen = new Set<string>();
    const visit = (file: string): boolean => {
      if (reaches.has(file)) return true;
      if (seen.has(file)) return false;
      seen.add(file);
      const text = textOf(file);
      const hit =
        named(file) ||
        mocksModules(text) ||
        [...text.matchAll(RELATIVE_IMPORT)].some(([, specifier]) => {
          const target = resolveRelative(resolve(dirname(file), specifier!));
          return target !== undefined && visit(target);
        });
      if (hit) reaches.add(file);
      return hit;
    };
    return visit(entry);
  };
}

/** The file a relative specifier names, including a `.js` that means `.ts`. */
function resolveRelative(path: string): string | undefined {
  const stem = path.replace(/\.m?js$/, "");
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => path + extension),
    ...(stem === path ? [] : SOURCE_EXTENSIONS.map((extension) => stem + extension)),
    ...INDEX_FILES.map((index) => path + index),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}
