import { projectIdsOf, userIdsOf, type FeatureFlagRules } from "@langwatch/feature-flag-contract";
import type { OpsFeatureFlagTarget, OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";

import { parseTargetIds, type ScopeKind } from "./rule-editing.ts";

/** The scopes whose target is an organization, project or user picked by search. */
export type PickedScopeKind = Extract<ScopeKind, "ORGANIZATION" | "PROJECT" | "USER">;

/**
 * Which targets a rule scope picks from the directory, and how many it holds;
 * see modules/ops/specs/feature-flag-target-search.feature.
 */
export const PICKED_TARGET_SCOPES: Record<
  PickedScopeKind,
  { kind: OpsFeatureFlagTargetKind; multiple: boolean }
> = {
  ORGANIZATION: { kind: "organization", multiple: false },
  PROJECT: { kind: "project", multiple: true },
  USER: { kind: "user", multiple: true },
};

/** Whether a scope searches for its target instead of typing it. */
export function isPickedScope(scope: ScopeKind): scope is PickedScopeKind {
  return scope in PICKED_TARGET_SCOPES;
}

/** The ids stored rules name, so the dialog can show each by name. */
export function targetIdsOf(rules: FeatureFlagRules): {
  organizationIds: string[];
  projectIds: string[];
  userIds: string[];
} {
  const unique = (ids: string[]) => [...new Set(ids.filter((id) => id !== ""))];
  return {
    organizationIds: unique(rules.flatMap((rule) => rule.match.organizationId ?? [])),
    projectIds: unique(rules.flatMap((rule) => projectIdsOf(rule.match.projectId))),
    userIds: unique(rules.flatMap((rule) => userIdsOf(rule.match.userId))),
  };
}

/** One key per target across kinds, since an id alone could name two different things. */
export function targetKey({ kind, id }: { kind: OpsFeatureFlagTargetKind; id: string }): string {
  return `${kind}:${id}`;
}

/** The ids a field holds, in order, without repeats. */
export function heldIds(target: string): string[] {
  return [...new Set(parseTargetIds(target))];
}

/** The field after a pick: a single-target scope swaps its id, a list scope appends it. */
export function withPickedId({
  target,
  id,
  multiple,
}: {
  target: string;
  id: string;
  multiple: boolean;
}): string {
  if (!multiple) return id;
  const ids = heldIds(target);
  return (ids.includes(id) ? ids : [...ids, id]).join(", ");
}

/** The field after removing one id. */
export function withoutId({ target, id }: { target: string; id: string }): string {
  return heldIds(target)
    .filter((held) => held !== id)
    .join(", ");
}

/** What a search result or chip is called first: a user by address, else by name. */
export function targetTitle(target: OpsFeatureFlagTarget): string {
  if (target.kind === "user") return target.email ?? target.name ?? target.id;
  return target.name;
}
