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
