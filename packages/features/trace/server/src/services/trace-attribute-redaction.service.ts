import {
  type CompiledAttributeMatcher,
  compileAttributePatterns,
} from "@langwatch/data-privacy-contract";
import type { Protections } from "./trace-viewer-protections.service";

interface HiddenMatcher extends CompiledAttributeMatcher {
  visibleTo: string;
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

/**
 * Read-time enforcement for RESTRICTED custom attribute rules: replaces the
 * values of span/trace attributes whose dotted path matches a hidden pattern
 * with a placeholder naming who CAN see them. Works on both flat dotted-key
 * records ({"gen_ai.prompt.id": "x"}) and nested objects
 * ({gen_ai: {prompt: {id: "x"}}}); arrays are treated as leaves (a matched
 * array is replaced whole, never entered). The input is never mutated, and the
 * SAME reference comes back when nothing matched, so memoized consumers stay
 * cheap.
 *
 * One redactor holds the compiled patterns, so a request that redacts many
 * records — a trace's spans and their events — compiles them once and reuses
 * them, rather than passing a matcher list from call to call.
 */
export class TraceAttributeRedactor {
  static for(hidden: Protections["hiddenAttributes"]): TraceAttributeRedactor {
    const rules = hidden ?? [];
    const compiled = compileAttributePatterns(rules.map((rule) => rule.pattern));
    return new TraceAttributeRedactor(
      compiled.map((matcher, index) => ({
        ...matcher,
        visibleTo: rules[index]?.visibleTo ?? "no one",
      })),
    );
  }

  private constructor(private readonly matchers: HiddenMatcher[]) {}

  /**
   * Redact per the viewer's hidden-attribute rules, returning the original
   * reference when nothing matches or nothing is hidden.
   */
  redact<T extends Record<string, unknown> | null | undefined>(value: T): T {
    if (!value || this.matchers.length === 0) {
      return value;
    }
    const result = this.redactNode(value, "");
    return (result.changed ? result.value : value) as T;
  }

  private placeholderFor(path: string): string | null {
    for (const matcher of this.matchers) {
      if (matcher.regex.test(path)) {
        return `[REDACTED] (visible to ${matcher.visibleTo})`;
      }
    }
    return null;
  }

  private redactNode(
    node: Record<string, unknown>,
    prefix: string,
  ): { value: Record<string, unknown>; changed: boolean } {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const placeholder = this.placeholderFor(path);
      if (placeholder !== null) {
        next[key] = placeholder;
        changed = true;
        continue;
      }
      if (isPlainObject(value)) {
        const child = this.redactNode(value, path);
        next[key] = child.value;
        changed = changed || child.changed;
        continue;
      }
      next[key] = value;
    }
    return changed ? { value: next, changed } : { value: node, changed };
  }
}
