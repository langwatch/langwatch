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
 *     binding on, plus their own personal workspace project. The team list
 *     keeps the organization's team order so the chips render stably.
 *
 * Bindings come from `api.apiKey.myBindings` (the same source the API key
 * drawers mirror the user's ceiling from), so the defaults can never offer
 * a scope the approve endpoint would refuse.
 */
import type { ScopeTriadEntry } from "~/components/settings/ScopeChipPicker";

export function defaultCliKeyScopes(args: {
  organizationId: string;
  /** The caller's own role bindings in this organization. */
  bindings:
    | Array<{ scopeType: string; scopeId: string; role: string }>
    | undefined;
  /** Non-personal team ids of the organization, in display order. */
  sharedTeamIds: string[];
  /** The caller's own personal workspace project, when one exists. */
  personalProjectId: string | null;
}): ScopeTriadEntry[] {
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
  const scopes: ScopeTriadEntry[] = args.sharedTeamIds
    .filter((teamId) => boundTeamIds.has(teamId))
    .map((teamId) => ({ scopeType: "TEAM", scopeId: teamId }));

  if (args.personalProjectId) {
    scopes.push({ scopeType: "PROJECT", scopeId: args.personalProjectId });
  }
  return scopes;
}
