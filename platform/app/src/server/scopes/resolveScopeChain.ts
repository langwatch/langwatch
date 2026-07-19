import { type ScopeAssignment } from "./scope.types";

/**
 * The `PROJECT -> TEAM -> ORGANIZATION` cascade chain for a single project
 * context, ordered most-specific-first.
 *
 * Readers map this chain onto whichever storage shape the resource uses:
 *   - multi-scope-per-row (junction) tables apply it as
 *     `scopes: { some: { OR: resolveScopeChain(ctx) } }`
 *   - single-scope-per-row (inline) tables apply it as
 *     `{ organizationId, OR: resolveScopeChain(ctx) }`
 *
 * Only the canonical tier order and id mapping live here. The tie-break
 * semantics that decide which matched row WINS (lower tier beats higher,
 * newest-within-tier, feature override beats role default) stay in the
 * per-feature resolver that consumes this chain — so the chain has exactly one
 * definition while each feature keeps its own resolution policy. See ADR-021.
 */
export function resolveScopeChain(ctx: {
  organizationId: string;
  teamId: string;
  projectId: string;
}): ScopeAssignment[] {
  return [
    { scopeType: "PROJECT", scopeId: ctx.projectId },
    { scopeType: "TEAM", scopeId: ctx.teamId },
    { scopeType: "ORGANIZATION", scopeId: ctx.organizationId },
  ];
}
