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
 * System instructions and tool calls do not only live in their own attributes
 * (`gen_ai.system_instructions`, `gen_ai.tool.call.*`); they also ride inside the
 * captured input/output conversation as chat messages with `role: "system"` or
 * `role: "tool"`, and as `tool_calls` on assistant messages. Canonicalization
 * (which runs AFTER the drop) re-derives `gen_ai.system_instructions` from that
 * conversation, so dropping the key alone is not enough: the role has to be
 * stripped from the conversation arrays too, or the content survives.
 */
const ROLE_BASED_CATEGORY_ROLES: Partial<Record<ContentCategory, readonly string[]>> = {
  system: ["system"],
  tools: ["tool", "function"],
};

/**
 * What a resolved privacy policy means for a payload, independent of the shape
 * that payload arrives in.
 *
 * Split from the OTLP-span walker deliberately, the same way the PII redaction
 * slice split: these decisions — which keys a `drop` category covers, which
 * message roles have to come out of a conversation, which custom patterns
 * compile — are the same for a span, a log record and a metric, and only the
 * walk over the payload differs. Every method is pure and free of I/O.
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
   * Remove the given message roles (and optionally assistant `tool_calls`) from a
   * conversation serialized as JSON. Handles the LangWatch
   * `{ type: "chat_messages", value: [...] }` wrapper and a bare messages array.
   * Returns the rewritten JSON and how many messages/tool-call sets were removed,
   * or `null` when the value is not a conversation (left untouched, never thrown).
   */
  tryStripRolesFromChatArrayJson(
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
