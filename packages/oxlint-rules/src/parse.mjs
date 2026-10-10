import { readFileSync, statSync } from "node:fs";

import { parseSync } from "oxc-parser";

// The CLI's way into the same tree the linter walks. oxlint parses with oxc
// and hands its plugins an ESTree program; the CLI parses the file itself
// with the same parser and the same options, so the two can never disagree
// about a policy. Kept out of the plugin's import graph on purpose: the
// linter has already parsed by the time a rule runs.

/**
 * The ESTree program for one TypeScript source, shaped exactly as the oxlint
 * plugin AST is: parentheses collapsed, TypeScript nodes present.
 *
 * @param {{ path: string, text: string }} file
 * @returns {object} The `Program` node.
 */
export function parseProgram({ path, text }) {
  return parseSync(path, text, {
    astType: "ts",
    lang: path.endsWith(".tsx") ? "tsx" : "ts",
    preserveParens: false,
    sourceType: "module",
  }).program;
}

const parsedFiles = new Map();

/**
 * The program of a file on disk, parsed once per process and file version. Every rule that
 * reads an imported file shares this entry, so one file is never parsed twice.
 * @param {string} filename Absolute path.
 * @returns {{ program: object, mtime: number, size: number }}
 */
export function parseFile(filename) {
  const stat = statSync(filename);
  const cached = parsedFiles.get(filename);
  if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached;
  const program = parseProgram({ path: filename, text: readFileSync(filename, "utf8") });
  const parsed = { mtime: stat.mtimeMs, program, size: stat.size };
  parsedFiles.set(filename, parsed);

  return parsed;
}
