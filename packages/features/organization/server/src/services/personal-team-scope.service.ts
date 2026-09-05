import { PersonalWorkspaceNotManagedHereError } from "@langwatch/organization-contract";
import type { RoleBindingScopeType } from "@langwatch/organization-contract";

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

/** The two personal-workspace reads the refusals below rest on. */
export interface PersonalTeamScopeReader {
  tryFindPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
  }): Promise<{ name: string } | null>;

  tryFindForeignPersonalTeamInScopes(input: {
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string } | null>;
}

export async function scopesTouchPersonalTeam({
  reader,
  scopes,
}: {
  reader: PersonalTeamScopeReader;
  scopes: RoleBindingScope[];
}): Promise<boolean> {
  return (await reader.tryFindPersonalTeamInScopes({ scopes })) !== null;
}

/**
 * Refuse any role-binding write that would change who reaches a personal team.
 *
 * A personal team holds exactly one member, its owner. Granting a second user
 * or a group access leaves the team flagged personal while it is shared in
 * every way that matters, so the workspace the owner is promised privacy in is
 * no longer private. A group ADMIN binding also defeats the last-admin
 * projection that is the only thing stopping the owner from being removed from
 * their own workspace.
 *
 * The invariant lives here rather than at each entry point because role
 * bindings are written from the role-binding service, the group router, the
 * member-role path and the team editor, and only some of them share a code
 * path.
 *
 * Pass every scope a write touches, creates and deletes alike: removing the
 * owner's binding is as much a membership change as adding someone else's.
 */
export async function assertNoPersonalTeamScope({
  reader,
  scopes,
}: {
  reader: PersonalTeamScopeReader;
  scopes: RoleBindingScope[];
}): Promise<void> {
  const personalTeam = await reader.tryFindPersonalTeamInScopes({ scopes });
  if (personalTeam) {
    throw new PersonalWorkspaceNotManagedHereError(personalTeam.name);
  }
}

/**
 * Refuse a role-binding write that reaches a personal workspace belonging to
 * anyone but the user the credential acts as.
 *
 * The API-key mint path needs this shape rather than
 * {@link assertNoPersonalTeamScope}: a key OWNED by the workspace's owner is
 * that owner acting programmatically, so a blanket refusal would take the
 * owner's own workspace away from their own credentials. What must never
 * happen is the workspace admitting a SECOND principal.
 */
export async function assertPersonalTeamScopesOwnedBy({
  reader,
  scopes,
  ownerUserId,
}: {
  reader: PersonalTeamScopeReader;
  scopes: RoleBindingScope[];
  /**
   * The user the credential acts as. `null` owns no personal workspace, so
   * every personal scope is refused.
   */
  ownerUserId: string | null;
}): Promise<void> {
  const foreignPersonalTeam = await reader.tryFindForeignPersonalTeamInScopes({
    scopes,
    ownerUserId,
  });
  if (foreignPersonalTeam) {
    throw new PersonalWorkspaceNotManagedHereError(foreignPersonalTeam.name);
  }
}
