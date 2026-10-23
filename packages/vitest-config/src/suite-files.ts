import { globSync } from "node:fs";
import { matchesGlob } from "node:path";

const GLOB_SPECIAL = /[\\*?[\]{}()!+@]/g;

/** The test files a suite's include and exclude select, relative to `base`, sorted. */
export function suiteFiles(base: string, include: string[], exclude: string[]): string[] {
  return globSync(include, {
    cwd: base,
    exclude: (entry) => /(^|\/)(node_modules|dist)$/.test(String(entry)),
  })
    .filter((file) => !exclude.some((pattern) => matchesGlob(file, pattern)))
    .toSorted();
}

/** A glob that matches exactly this file name, glob characters and all. */
export function literalGlob(file: string): string {
  return file.replace(GLOB_SPECIAL, "\\$&");
}
