/**
 * Default scope selection for the CLI login key on the device-session
 * authorize screen (`/cli/auth`, credential_type device_session).
 *
 * The key a `langwatch login` mints should reach everything the user works
 * with, so the preselected scopes mirror the widest access they hold:
 *
 *   - An ORGANIZATION-scoped binding of any role collapses to a single
 *     organization chip: one binding already covers every project, at
 *     whatever level the role allows. A MEMBER or VIEWER org binding is
 *     org-wide access too, so narrowing it to the personal project would
 *     hand the key less than the user holds.
 *   - Everyone else starts from the shared teams they hold a TEAM-scoped
 *     binding on, plus their own personal workspace project. The team list
 *     keeps the organization's team order so the chips render stably.
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
  personalProjectId: string | null;
}): ApiKeyScopeSelection[] {
  const bindings = args.bindings ?? [];

  const hasOrgBinding = bindings.some(
    (b) => b.scopeType === "ORGANIZATION" && b.scopeId === args.organizationId,
  );
  if (hasOrgBinding) {
    return [{ scopeType: "ORGANIZATION", scopeId: args.organizationId }];
  }

  const boundTeamIds = new Set(
    bindings.filter((b) => b.scopeType === "TEAM").map((b) => b.scopeId),
  );
  const scopes: ApiKeyScopeSelection[] = args.sharedTeamIds
    .filter((teamId) => boundTeamIds.has(teamId))
    .map((teamId) => ({ scopeType: "TEAM", scopeId: teamId }));

  if (args.personalProjectId) {
    scopes.push({ scopeType: "PROJECT", scopeId: args.personalProjectId });
  }
  return scopes;
}
