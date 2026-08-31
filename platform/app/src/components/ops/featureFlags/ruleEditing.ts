import type { FeatureFlagRules } from "~/server/featureFlag";

/**
 * The editing model behind the targeting-rules dialog.
 *
 * Stored rules are a `match` object with optional keys; the dialog shows one
 * scope picker and one field. Translating between the two shapes is the only
 * thing in here, kept free of React so the ordering decisions — which are
 * where first-match-wins bites — can be read and tested on their own.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

export type ScopeKind =
  | "EVERYONE"
  | "ORGANIZATION"
  | "PROJECT"
  /** Organizations created on or after a date — shown as "New users". */
  | "NEW_USERS";

export interface UIRule {
  /**
   * Identity for React and for drag-reordering. Rules carry no id of their
   * own and two rules can be identical while the operator fills them in, so
   * the list index cannot serve: reordering by index makes the wrong row
   * animate and re-mounts inputs mid-edit.
   */
  id: string;
  scopeKind: ScopeKind;
  /** An organization or project id, or a date for `NEW_USERS`. */
  target: string;
  enabled: boolean;
}

let nextRuleId = 0;

export function newRuleId(): string {
  nextRuleId += 1;
  return `rule-${nextRuleId}`;
}

export function newRule(): UIRule {
  return {
    id: newRuleId(),
    scopeKind: "ORGANIZATION",
    target: "",
    enabled: true,
  };
}

export function rulesToUI(rules: FeatureFlagRules): UIRule[] {
  // Empty input → seed the dialog with one org-scoped rule so operators
  // see the shape they're about to fill in instead of an empty pane.
  if (rules.length === 0) return [newRule()];
  return rules.map((rule) => {
    const base = { id: newRuleId(), enabled: rule.enabled };
    if (rule.match.organizationId) {
      return {
        ...base,
        scopeKind: "ORGANIZATION" as const,
        target: rule.match.organizationId,
      };
    }
    if (rule.match.projectId) {
      return {
        ...base,
        scopeKind: "PROJECT" as const,
        target: rule.match.projectId,
      };
    }
    if (rule.match.organizationCreatedAfter) {
      return {
        ...base,
        scopeKind: "NEW_USERS" as const,
        target: toDateInputValue(rule.match.organizationCreatedAfter),
      };
    }
    return { ...base, scopeKind: "EVERYONE" as const, target: "" };
  });
}

export function uiToRules(rules: UIRule[]): FeatureFlagRules {
  return rules.map((rule) => {
    const target = rule.target.trim();
    if (rule.scopeKind === "ORGANIZATION") {
      return { match: { organizationId: target }, enabled: rule.enabled };
    }
    if (rule.scopeKind === "PROJECT") {
      return { match: { projectId: target }, enabled: rule.enabled };
    }
    if (rule.scopeKind === "NEW_USERS") {
      return {
        match: { organizationCreatedAfter: target },
        enabled: rule.enabled,
      };
    }
    return { match: {}, enabled: rule.enabled };
  });
}

/**
 * Where an added rule goes.
 *
 * Rules are first-match-wins, and an "Everyone" rule matches every context,
 * so anything below one can never fire. Appending to a list that ends in
 * Everyone therefore hands the operator a rule that reads as live and is
 * dead — the new rule goes directly above it instead. With no trailing
 * Everyone rule, an added rule is the lowest-priority one, which is what
 * appending already means.
 */
export function insertionIndexForNewRule(rules: UIRule[]): number {
  const last = rules[rules.length - 1];
  return last?.scopeKind === "EVERYONE" ? rules.length - 1 : rules.length;
}

export function withRuleAdded(rules: UIRule[], rule: UIRule): UIRule[] {
  const index = insertionIndexForNewRule(rules);
  return [...rules.slice(0, index), rule, ...rules.slice(index)];
}

/** Moves the rule with `fromId` to the position currently held by `toId`. */
export function withRuleMoved(
  rules: UIRule[],
  { fromId, toId }: { fromId: string; toId: string },
): UIRule[] {
  const from = rules.findIndex((rule) => rule.id === fromId);
  const to = rules.findIndex((rule) => rule.id === toId);
  if (from < 0 || to < 0 || from === to) return rules;
  const moved = [...rules];
  const [rule] = moved.splice(from, 1);
  if (!rule) return rules;
  moved.splice(to, 0, rule);
  return moved;
}

/**
 * The rule this operator has left unfillable, or undefined when every rule
 * can match something. A scoped rule with no target and a new-users
 * rule with no date are both rules the operator believes are live.
 */
export function findUnfillableRule(rules: UIRule[]): UIRule | undefined {
  return rules.find(
    (rule) => rule.scopeKind !== "EVERYONE" && rule.target.trim() === "",
  );
}

/**
 * Renders a stored `organizationCreatedAfter` for an `<input type="date">`,
 * which only accepts `YYYY-MM-DD`. Rows written by this dialog already carry
 * that shape; a full ISO instant written by hand or by a future writer is
 * narrowed to its day rather than silently emptying the field.
 */
function toDateInputValue(stored: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  const parsed = Date.parse(stored);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}
