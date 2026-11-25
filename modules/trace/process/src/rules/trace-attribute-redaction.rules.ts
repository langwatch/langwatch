import {
  type CompiledAttributeMatcher,
  compileAttributePatterns,
  CONTENT_CATEGORIES,
  type ContentCategory,
} from "@langwatch/data-privacy-contract";
import type { Protections } from "@langwatch/trace-contract";

interface HiddenMatcher extends CompiledAttributeMatcher {
  visibleTo: string;
}

type RedactionResult = { value: Record<string, unknown>; changed: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  // Span params are unflattened into bare records, which may carry a null
  // prototype; class instances (Date, Map, ...) stay leaves.
  const proto: unknown = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function redactNode({
  matchers,
  node,
  prefix,
}: {
  matchers: readonly HiddenMatcher[];
  node: Record<string, unknown>;
  prefix: string;
}): RedactionResult {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const hiddenBy = matchers.find((matcher) => matcher.regex.test(path));
    if (hiddenBy) {
      next[key] = `[REDACTED] (visible to ${hiddenBy.visibleTo})`;
      changed = true;
      continue;
    }

    if (isPlainObject(value)) {
      const child = redactNode({ matchers, node: value, prefix: path });
      next[key] = child.value;
      changed = changed || child.changed;
      continue;
    }

    next[key] = value;
  }

  return changed ? { value: next, changed } : { value: node, changed };
}

/**
 * Read-time redaction of restricted custom attributes: a value whose dotted path matches a hidden
 * pattern becomes a placeholder naming who can see it. Arrays are leaves, input is never mutated,
 * the original reference returns when nothing matches, and patterns compile once per redactor.
 */
export function createAttributeRedactor({
  hidden,
}: {
  hidden: Protections["hiddenAttributes"];
}): <T extends Record<string, unknown> | null | undefined>(value: T) => T {
  const rules = hidden ?? [];
  const matchers: HiddenMatcher[] = compileAttributePatterns(rules.map((rule) => rule.pattern)).map(
    (matcher, index) => ({ ...matcher, visibleTo: rules[index]?.visibleTo ?? "no one" }),
  );

  return <T extends Record<string, unknown> | null | undefined>(value: T): T => {
    if (!value || matchers.length === 0) {
      return value;
    }

    const result = redactNode({ matchers, node: value, prefix: "" });

    return (result.changed ? result.value : value) as T;
  };
}

type CategoryProtections = Pick<
  Protections,
  | "canSeeCapturedInput"
  | "canSeeCapturedOutput"
  | "capturedInputVisibleTo"
  | "capturedOutputVisibleTo"
  | "contentCategories"
>;

/** Whether the viewer may read a category, and the audience label when a rule restricts it. */
function categoryVisibility(
  protections: CategoryProtections,
): Record<ContentCategory, { canSee: boolean; visibleTo: string | null | undefined }> {
  const categories = protections.contentCategories;

  return {
    input: {
      canSee: categories?.input.canSee ?? protections.canSeeCapturedInput === true,
      visibleTo: categories?.input.restrictVisibleTo ?? protections.capturedInputVisibleTo,
    },
    output: {
      canSee: categories?.output.canSee ?? protections.canSeeCapturedOutput === true,
      visibleTo: categories?.output.restrictVisibleTo ?? protections.capturedOutputVisibleTo,
    },
    system: {
      canSee: categories?.system.canSee ?? true,
      visibleTo: categories?.system.restrictVisibleTo,
    },
    tools: {
      canSee: categories?.tools.canSee ?? true,
      visibleTo: categories?.tools.restrictVisibleTo,
    },
  };
}

/**
 * Hidden-attribute rules for the keys carrying each content category the viewer cannot see, so
 * their values are replaced whole by the audience placeholder. Shared by the span protections and
 * the v2 read mappers, so one attribute never carries two different audience labels.
 */
export function hiddenContentCategoryRules({
  protections,
  contentKeyCatalog,
}: {
  protections: CategoryProtections;
  contentKeyCatalog: Readonly<Record<ContentCategory, readonly string[]>>;
}): { pattern: string; visibleTo: string }[] {
  const categories = categoryVisibility(protections);

  return CONTENT_CATEGORIES.flatMap((category) =>
    categories[category].canSee
      ? []
      : contentKeyCatalog[category].map((pattern) => ({
          pattern,
          // No restrict label means the content is hidden by membership (or a fail-closed policy
          // read), not by an audience rule.
          visibleTo: categories[category].visibleTo ?? "members of this project",
        })),
  );
}
