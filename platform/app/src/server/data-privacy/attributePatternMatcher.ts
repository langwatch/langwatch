/**
 * Matching for custom attribute rules: a pattern is an attribute key, where
 * `*` matches any run of characters (including dots), e.g. `gen_ai.prompt.*`
 * matches `gen_ai.prompt.id` and `gen_ai.prompt.variables.name`. Everything
 * else is literal, so a pattern without `*` is an exact-key match. Patterns
 * compile to anchored regexes built only from escaped literals and `.*`, which
 * cannot backtrack catastrophically.
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

export function compileAttributePatterns(
  patterns: string[],
): CompiledAttributeMatcher[] {
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
