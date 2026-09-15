/**
 * The cascade the Default Models table renders, as pure functions. Every
 * cell shows the FINAL RESOLVED state for the row's scope — pinned versus
 * inherited is only differentiated in the edit drawer — so the walk is
 * stated here rather than in the component, testable without a DOM.
 * Contract: specs/model-providers/role-based-default-models.feature,
 *           specs/model-providers/model-default-config-cascade.feature.
 */

import type {
  ModelDefaultConfigSnapshot as StoredModelDefaultConfigSnapshot,
  ModelDefaultEffective,
  ModelProviderScopeType,
} from "@langwatch/model-provider-contract";
import type { WireOf } from "@langwatch/api/web";

/** A saved default as the browser holds one: its instants are ISO strings. */
type ModelDefaultConfigSnapshot = WireOf<StoredModelDefaultConfigSnapshot>;
import type { ScopeHierarchy } from "./provider-scope-filter.ts";
import { scopeBreadthRank } from "./scope-breadth.ts";
import { toEpochMs } from "@langwatch/time";

/** The four role columns, in the order the table reads them. */
export const MODEL_ROLES = ["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"] as const;
export type ModelRoleKey = (typeof MODEL_ROLES)[number];

export const MODEL_ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  LANGY: "Langy",
  EMBEDDINGS: "Embeddings",
};

/** One tier of the cascade: a scope type and the id of the scope at that tier. */
export type AnchorScope = { type: ModelProviderScopeType; id: string };

/** `ModelDefaultEffective.scope` spells the tier in lower case; this is the map. */
const EFFECTIVE_SCOPE: Record<ModelProviderScopeType, "organization" | "team" | "project"> = {
  ORGANIZATION: "organization",
  TEAM: "team",
  PROJECT: "project",
};

/**
 * Broadest scope a config attaches to, in breadth order (organization, then
 * team, then project), tie-broken by name.
 */
function broadestScopeOfConfig(
  scopes: ModelDefaultConfigSnapshot["scopes"],
): ModelDefaultConfigSnapshot["scopes"][number] | undefined {
  return [...scopes].sort(
    (a, b) =>
      scopeBreadthRank(a.type) - scopeBreadthRank(b.type) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  )[0];
}

/** Orders config rows broadest scope first, then by that scope's name. */
export function compareConfigsByScopeThenName(
  a: ModelDefaultConfigSnapshot,
  b: ModelDefaultConfigSnapshot,
): number {
  const sa = broadestScopeOfConfig(a.scopes);
  const sb = broadestScopeOfConfig(b.scopes);
  const ra = sa ? scopeBreadthRank(sa.type) : Number.MAX_SAFE_INTEGER;
  const rb = sb ? scopeBreadthRank(sb.type) : Number.MAX_SAFE_INTEGER;
  return ra - rb || (sa?.name ?? "").localeCompare(sb?.name ?? "");
}

/**
 * Most-specific scope a policy attaches to (PROJECT > TEAM > ORGANIZATION).
 *
 * The cell uses this as the anchor for the cascade walk, so a row showing
 * "Team Platform + Project edge" resolves at the project — the model code
 * running on that project would actually see.
 */
export function mostSpecificScope(
  scopes: ModelDefaultConfigSnapshot["scopes"],
): AnchorScope | null {
  const project = scopes.find((scope) => scope.type === "PROJECT");
  if (project) return { type: "PROJECT", id: project.id };
  const team = scopes.find((scope) => scope.type === "TEAM");
  if (team) return { type: "TEAM", id: team.id };
  const organization = scopes.find((scope) => scope.type === "ORGANIZATION");
  if (organization) return { type: "ORGANIZATION", id: organization.id };
  return null;
}

/**
 * The anchor's own parent chain, most specific first: a project walks project,
 * its own team, then the organization; a team walks team then organization. A
 * parent tier whose id can't be resolved from the hierarchy is skipped rather
 * than loosely matched.
 */
function cascadeChainFor(anchor: AnchorScope, hierarchy: ScopeHierarchy): AnchorScope[] {
  const organizationId = hierarchy.organization?.id ?? null;
  const chain: AnchorScope[] = [anchor];
  if (anchor.type === "PROJECT") {
    const teamId =
      (hierarchy.projects ?? []).find((project) => project.id === anchor.id)?.teamId ?? null;
    if (teamId) chain.push({ type: "TEAM", id: teamId });
  }
  if (anchor.type !== "ORGANIZATION" && organizationId) {
    chain.push({ type: "ORGANIZATION", id: organizationId });
  }
  return chain;
}

/**
 * Cascading walk for a single key, mirroring the server resolver's chain
 * (anchor, then its own parent scopes). Chain ids come from `hierarchy`
 * rather than matching parent tiers by type alone, which would surface
 * values from teams the anchor project does not belong to.
 */
export function resolveAtScope({
  key,
  configs,
  anchor,
  hierarchy,
}: {
  key: string;
  configs: readonly ModelDefaultConfigSnapshot[];
  anchor: AnchorScope;
  hierarchy: ScopeHierarchy;
}): ModelDefaultEffective | null {
  for (const tier of cascadeChainFor(anchor, hierarchy)) {
    const matching = configs
      .filter((config) =>
        config.scopes.some((scope) => scope.type === tier.type && scope.id === tier.id),
      )
      .filter((config) => config.config[key])
      .sort((a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt));
    const winner = matching[0];
    if (winner) {
      return {
        model: winner.config[key]!,
        source: "role_default",
        scope: EFFECTIVE_SCOPE[tier.type],
      };
    }
  }
  return null;
}
