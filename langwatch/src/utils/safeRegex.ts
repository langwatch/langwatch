import safe from "safe-regex2";

/**
 * Compiles a regex pattern and returns it only if it is safe from
 * catastrophic backtracking (per safe-regex2's static analysis).
 * Returns null when the pattern is invalid or unsafe.
 *
 * Use this wherever regex patterns come from user input — both
 * client (form validation) and server (match-time gating) should
 * share the same rules so the UI and runtime can't disagree.
 */
export function compileSafeRegex(pattern: string): RegExp | null {
  try {
    const re = new RegExp(pattern);
    return safe(re) ? re : null;
  } catch {
    return null;
  }
}

/**
 * Boolean wrapper for call sites that only need the pass/fail verdict.
 */
export function isSafeRegex(pattern: string): boolean {
  return compileSafeRegex(pattern) !== null;
}
