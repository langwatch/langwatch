/**
 * Whether a customer-written cost-rule pattern is safe to run.
 *
 * A cost rule's `regex` is typed into a form and then evaluated against every
 * model name a project has seen, so a pattern with nested unbounded
 * quantifiers is a way to stall the read path from the outside. `safe-regex2`
 * decides that statically; this is the one wrapper around it, so the form's
 * validation, the write schema's refinement and the match-time gate can never
 * disagree about which patterns are allowed.
 */
import safe from "safe-regex2";

/**
 * Compiles a pattern and returns it only when it is free of catastrophic
 * backtracking. Null when the pattern is invalid OR unsafe — the caller cannot
 * tell the two apart, and does not need to: both mean "do not run this".
 */
export function compileSafeRegex(pattern: string): RegExp | null {
  try {
    const compiled = new RegExp(pattern);
    return safe(compiled) ? compiled : null;
  } catch {
    return null;
  }
}

/** The pass/fail verdict, for call sites that do not need the compiled form. */
export function isSafeRegex(pattern: string): boolean {
  return compileSafeRegex(pattern) !== null;
}
