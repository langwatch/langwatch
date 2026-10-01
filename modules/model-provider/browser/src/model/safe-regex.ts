/**
 * The same `safe-regex2` verdict the server applies at the write boundary,
 * asked here too so the form's refusal never disagrees with the mutation's.
 * A family-local copy, since a browser bundle may not import the server package.
 */

import safe from "safe-regex2";

/** Compiles a pattern, and hands it back only if it cannot backtrack catastrophically. */
export function tryCompileSafeRegex(pattern: string): RegExp | null {
  try {
    const expression = new RegExp(pattern);
    return safe(expression) ? expression : null;
  } catch {
    return null;
  }
}

/** The pass/fail verdict, for call sites that need nothing else. */
export function isSafeRegex(pattern: string): boolean {
  return tryCompileSafeRegex(pattern) !== null;
}

/**
 * An anchored pattern matching exactly one model name. Escapes the forward slash too, even
 * though it's valid unescaped, because the cost-rule field renders patterns between `/.../`
 * delimiters. `@langwatch/trace-browser` keeps its own copy for the unmapped-cost suggestion.
 */
export function exactModelMatchRegex(model: string): string {
  return `^${model.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&")}$`;
}
