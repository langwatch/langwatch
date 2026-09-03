/**
 * Whether a pattern a customer typed is safe to run.
 *
 * The same `safe-regex2` verdict the server applies at the write boundary
 * (`@langwatch/model-provider-server`'s `model-cost-regex-safety.service.ts`,
 * which the tRPC input schema calls through a port). Asking it here as well is
 * what keeps the form's refusal and the server's from disagreeing: a rule the
 * field accepts is a rule the mutation will accept.
 *
 * A FAMILY-LOCAL COPY, like `@langwatch/data-privacy-web`'s. That package
 * recorded the same thing when it took the check for its pattern editor: the
 * shared home is the server package, a browser bundle may not import it, and
 * the predicate is four lines over one dependency. Recorded rather than
 * repeated silently.
 */

import safe from "safe-regex2";

/** Compiles a pattern, and hands it back only if it cannot backtrack catastrophically. */
export function compileSafeRegex(pattern: string): RegExp | null {
  try {
    const expression = new RegExp(pattern);
    return safe(expression) ? expression : null;
  } catch {
    return null;
  }
}

/** The pass/fail verdict, for call sites that need nothing else. */
export function isSafeRegex(pattern: string): boolean {
  return compileSafeRegex(pattern) !== null;
}

/**
 * An anchored pattern matching exactly one model name.
 *
 * Every regex metacharacter is escaped, the forward slash included: `/` is
 * valid unescaped in a pattern compiled from a string, but the cost-rule field
 * renders patterns between `/.../` delimiters, so emitting `\\/` keeps the
 * displayed literal unambiguous. Recovered alongside the drawer from
 * `platform/app/src/utils/modelCostRegex.ts`; `@langwatch/trace-web` keeps its
 * own copy for the unmapped-cost suggestion, which is the other surface that
 * offers to fill this field.
 */
export function exactModelMatchRegex(model: string): string {
  return `^${model.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&")}$`;
}
