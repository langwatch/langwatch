/**
 * Default scope selection for the CLI login key on the device-session
 * authorize screen (`/cli/auth`, credential_type device_session).
 *
 * The key a `langwatch login` mints should reach everything the user works
 * with, so the preselected scopes mirror the widest access they hold:
 *
 *   - An ORGANIZATION-scoped ADMIN or CUSTOM binding collapses to a single
 *     organization chip: the resolver answers org-scope checks from it (ADMIN
 *     grants everything; CUSTOM resolves its own permission list). A MEMBER
 *     or VIEWER org binding does NOT qualify — the resolver grants it the
 *     org-member bag only (organization:view, aiTools:view), so an org-scoped
 *     selection built from it can never carry traces or any other everyday
 *     permission and the approve endpoint refuses it wholesale.
 *   - Everyone else starts from the shared teams they hold a TEAM-scoped
 *     binding on, plus their personal workspace project — the latter only
 *     when the TEAM binding on the personal team is actually held: the
 *     owner grant is appended to the grants ledger asynchronously and is
 *     skipped outright on a ledger outage, so the project can be visible
 *     while the binding row is not, and a PROJECT chip without it resolves
 *     a ceiling of org-exclusive permissions the mint then strips
 *     (`filterToGrantable`), failing the approval. The team list keeps the
 *     organization's team order so the chips render stably.
 *   - When that leaves nothing, any ORGANIZATION binding still yields the
 *     organization chip: it mints a view-only key (organization:view,
 *     aiTools:view), and a working login beats a dead-ended screen. Only a
 *     caller with no bindings at all gets an empty list — no chip could
 *     ever enable approve for them.
 *
 * Bindings come from `api.apiKey.myBindings` (the same source the API key
 * drawers mirror the user's ceiling from), so the defaults can never offer
 * a scope the approve endpoint would refuse.
 *
 * Moved from `platform/app/src/pages/cli/cliKeyScopeDefaults.ts` unchanged
 * except for the entry type, which is this package's own
 * {@link ApiKeyScopeSelection} rather than the scope picker surface's
 * `ScopeTriadEntry` — the two are the same two fields, and naming the surface
 * from a model module would buy a `ui-screen-closure` finding for nothing.
 */
import type { ApiKeyScopeSelection } from "./api-key-scope";

export function defaultCliKeyScopes(args: {
  organizationId: string;
  /** The caller's own role bindings in this organization. */
  bindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  /** Non-personal team ids of the organization, in display order. */
  sharedTeamIds: string[];
  /** The caller's own personal workspace project, when one exists. */
  personalProject: { id: string; teamId: string } | null;
}): ApiKeyScopeSelection[] {
  const bindings = args.bindings ?? [];

  const hasOrgWideBinding = bindings.some(
    (b) =>
      b.scopeType === "ORGANIZATION" &&
      b.scopeId === args.organizationId &&
      (b.role === "ADMIN" || b.role === "CUSTOM"),
  );
  if (hasOrgWideBinding) {
    return [{ scopeType: "ORGANIZATION", scopeId: args.organizationId }];
  }

  const boundTeamIds = new Set(
    bindings.filter((b) => b.scopeType === "TEAM").map((b) => b.scopeId),
  );
  const scopes: ApiKeyScopeSelection[] = args.sharedTeamIds
    .filter((teamId) => boundTeamIds.has(teamId))
    .map((teamId) => ({ scopeType: "TEAM", scopeId: teamId }));

  if (args.personalProject && boundTeamIds.has(args.personalProject.teamId)) {
    scopes.push({ scopeType: "PROJECT", scopeId: args.personalProject.id });
  }
  if (scopes.length > 0) return scopes;

  const hasAnyOrgBinding = bindings.some(
    (b) => b.scopeType === "ORGANIZATION" && b.scopeId === args.organizationId,
  );
  if (hasAnyOrgBinding) {
    return [{ scopeType: "ORGANIZATION", scopeId: args.organizationId }];
  }
  return [];
}
