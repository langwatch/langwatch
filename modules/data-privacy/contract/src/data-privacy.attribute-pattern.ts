/**
 * Matching for custom attribute rules: `*` matches any run of characters
 * (including dots), else literal. Compiles to anchored regexes from
 * escaped literals and `.*` only, so it cannot backtrack catastrophically.
 */

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileAttributePattern(pattern: string): RegExp {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`);
}

export interface CompiledAttributeMatcher {
  pattern: string;
  regex: RegExp;
}

export function compileAttributePatterns(patterns: string[]): CompiledAttributeMatcher[] {
  return patterns.map((pattern) => ({
    pattern,
    regex: compileAttributePattern(pattern),
  }));
}

export function matchesAnyAttributePattern(
  key: string,
  matchers: CompiledAttributeMatcher[],
): boolean {
  return matchers.some((m) => m.regex.test(key));
}
