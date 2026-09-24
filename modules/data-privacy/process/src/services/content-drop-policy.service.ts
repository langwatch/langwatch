import {
  CHAT_ARRAY_KEYS,
  CONTENT_CATEGORIES,
  CONTENT_KEY_CATALOG,
  compileAttributePatterns,
  matchesAnyAttributePattern,
  stripRolesFromChatArrayJson,
  type CompiledAttributeMatcher,
  type ContentCategory,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";

/**
 * Roles in chat messages must be stripped because canonicalization re-derives
 * system_instructions from the conversation after the drop.
 */
const ROLE_BASED_CATEGORY_ROLES: Partial<Record<ContentCategory, readonly string[]>> = {
  system: ["system"],
  tools: ["tool", "function"],
};

/**
 * Policy decisions independent of payload shape; decisions apply uniformly and
 * all methods are pure and free of I/O.
 */
export class ContentDropPolicyService {
  static create(): ContentDropPolicyService {
    return new ContentDropPolicyService();
  }

  private constructor() {}

  /**
   * For a resolved policy, the message roles to remove from conversation arrays
   * and whether assistant `tool_calls` should be stripped, derived from which
   * role-based categories (`system`, `tools`) are set to `drop`.
   */
  rolesDroppedFromChatArrays(policy: ResolvedDataPrivacy): {
    roles: Set<string>;
    stripToolCalls: boolean;
  } {
    const roles = new Set<string>();
    let stripToolCalls = false;
    for (const category of CONTENT_CATEGORIES) {
      const categoryRoles = ROLE_BASED_CATEGORY_ROLES[category];
      if (categoryRoles && policy.categories[category].disposition === "drop") {
        for (const role of categoryRoles) {
          roles.add(role);
        }

        if (category === "tools") {
          stripToolCalls = true;
        }
      }
    }

    return { roles, stripToolCalls };
  }

  /**
   * Removes given message roles (and optional assistant `tool_calls`) from
   * a serialized conversation (LangWatch wrapper or bare array). Returns
   * `null`, untouched, when the value isn't a conversation — never thrown.
   */
  deriveRoleStrippedChatArrayJson(
    json: string,
    roles: ReadonlySet<string>,
    stripToolCalls: boolean,
  ): { json: string; removed: number } | null {
    return stripRolesFromChatArrayJson(json, roles, stripToolCalls);
  }

  /**
   * The attribute keys dropped by `drop` CATEGORIES for a resolved policy: every
   * key of each `drop` category's built-in set. Custom attribute rules are
   * matched separately via `dropMatchers` (they support wildcards).
   */
  droppedKeys(policy: ResolvedDataPrivacy): Set<string> {
    const keys = new Set<string>();
    for (const category of CONTENT_CATEGORIES) {
      if (policy.categories[category].disposition === "drop") {
        for (const key of CONTENT_KEY_CATALOG[category]) {
          keys.add(key);
        }
      }
    }

    return keys;
  }

  /** Compiled matchers for the policy's `drop`-disposition custom attribute rules. */
  dropMatchers(policy: ResolvedDataPrivacy): CompiledAttributeMatcher[] {
    return compileAttributePatterns(
      policy.customAttributes
        .filter((rule) => rule.disposition === "drop")
        .map((rule) => rule.pattern),
    );
  }

  /** Whether this policy drops any content at all. */
  // The one question an interlock upstream of the drop asks: work that stores
  // span content — externalizing media at the ingest edge — must not run for a
  // project whose policy is about to discard it, or the platform writes bytes
  // the customer asked it not to keep.
  dropsAnyContent(policy: ResolvedDataPrivacy): boolean {
    const { roles, stripToolCalls } = this.rolesDroppedFromChatArrays(policy);

    return (
      this.droppedKeys(policy).size > 0 ||
      this.dropMatchers(policy).length > 0 ||
      roles.size > 0 ||
      stripToolCalls
    );
  }

  /** The categories currently set to `drop`, for the span marker / observability. */
  droppedCategories(policy: ResolvedDataPrivacy): ContentCategory[] {
    return CONTENT_CATEGORIES.filter((c) => policy.categories[c].disposition === "drop");
  }

  /** Whether a key holds a chat-message conversation the role strip has to walk. */
  isChatArrayKey(key: string): boolean {
    return CHAT_ARRAY_KEYS.has(key);
  }

  /**
   * Return a copy of an attribute map with every dropped key removed (exact
   * catalog keys plus wildcard custom matchers), how many keys were stripped, and
   * which keys the custom matchers removed. The input is not mutated.
   */
  stripDroppedAttributes(
    attributes: Record<string, unknown>,
    droppedKeys: Set<string>,
    dropMatchers: CompiledAttributeMatcher[] = [],
  ): {
    attributes: Record<string, unknown>;
    droppedCount: number;
    droppedAttributeKeys: string[];
  } {
    if (droppedKeys.size === 0 && dropMatchers.length === 0) {
      return { attributes, droppedCount: 0, droppedAttributeKeys: [] };
    }

    let droppedCount = 0;
    const droppedAttributeKeys: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (droppedKeys.has(key)) {
        droppedCount++;
        continue;
      }

      if (matchesAnyAttributePattern(key, dropMatchers)) {
        droppedCount++;
        droppedAttributeKeys.push(key);
        continue;
      }

      next[key] = value;
    }

    return { attributes: next, droppedCount, droppedAttributeKeys };
  }
}
