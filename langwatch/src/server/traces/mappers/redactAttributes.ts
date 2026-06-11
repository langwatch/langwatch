import {
  type CompiledAttributeMatcher,
  compileAttributePatterns,
} from "~/server/data-privacy/attributePatternMatcher";
import type { Protections } from "~/server/elasticsearch/protections";

/**
 * Read-time enforcement for RESTRICTED custom attribute rules: replaces the
 * values of span/trace attributes whose dotted path matches a hidden pattern
 * with a placeholder naming who CAN see them. Works on both flat dotted-key
 * records ({"gen_ai.prompt.id": "x"}) and nested objects
 * ({gen_ai: {prompt: {id: "x"}}}); arrays are treated as leaves (a matched
 * array is replaced whole, never entered). The input is never mutated, and the
 * SAME reference comes back when nothing matched, so memoized consumers stay
 * cheap.
 */

interface HiddenMatcher extends CompiledAttributeMatcher {
  visibleTo: string;
}

export function compileHiddenAttributeMatchers(
  hidden: NonNullable<Protections["hiddenAttributes"]>,
): HiddenMatcher[] {
  const compiled = compileAttributePatterns(hidden.map((h) => h.pattern));
  return compiled.map((matcher, i) => ({
    ...matcher,
    visibleTo: hidden[i]?.visibleTo ?? "no one",
  }));
}

function placeholderFor(
  path: string,
  matchers: HiddenMatcher[],
): string | null {
  for (const matcher of matchers) {
    if (matcher.regex.test(path)) {
      return `[REDACTED] (visible to ${matcher.visibleTo})`;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // Span params are unflattened into bare records, which may carry a null
  // prototype; class instances (Date, Map, ...) stay leaves.
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactNode(
  node: Record<string, unknown>,
  prefix: string,
  matchers: HiddenMatcher[],
): { value: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const placeholder = placeholderFor(path, matchers);
    if (placeholder !== null) {
      next[key] = placeholder;
      changed = true;
      continue;
    }
    if (isPlainObject(value)) {
      const child = redactNode(value, path, matchers);
      next[key] = child.value;
      changed = changed || child.changed;
      continue;
    }
    next[key] = value;
  }
  return changed ? { value: next, changed } : { value: node, changed };
}

/**
 * Redact the attribute record per the viewer's hidden-attribute rules. Returns
 * the original reference when nothing matches (or there is nothing to hide).
 */
export function redactHiddenAttributes<
  T extends Record<string, unknown> | null | undefined,
>(value: T, hidden: Protections["hiddenAttributes"]): T {
  if (!value || !hidden || hidden.length === 0) return value;
  const matchers = compileHiddenAttributeMatchers(hidden);
  const result = redactNode(value, "", matchers);
  return (result.changed ? result.value : value) as T;
}

/**
 * Same as `redactHiddenAttributes` but with the matchers pre-compiled, for
 * call sites that process many records (spans, events) per request.
 */
export function redactHiddenAttributesCompiled<
  T extends Record<string, unknown> | null | undefined,
>(value: T, matchers: HiddenMatcher[]): T {
  if (!value || matchers.length === 0) return value;
  const result = redactNode(value, "", matchers);
  return (result.changed ? result.value : value) as T;
}
