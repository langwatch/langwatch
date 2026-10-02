// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM is a reconciler, not a writer (ADR-092 decision 18).
 *
 * An identity provider pushes declarative state: "these are the grants this
 * principal should hold". It does not push edits, it re-pushes the same truth
 * on every sync, and it re-pushes it after a failure. So the handler reads
 * what the projection currently says, diffs the desired set against it, and
 * emits only the difference — which makes a replayed push emit nothing at all,
 * the property that keeps a nightly full sync from filling the ledger (and the
 * customer's audit page) with thousands of no-op facts.
 *
 * The direction matters as much as the diff: removals go first and carry
 * instant enforcement (decision 7), because an IdP deprovision is the
 * fired-employee case and the deny has to hold before this call returns.
 * Additions are plain queued commands.
 */
import type { LedgerActor } from "@langwatch/authorization";
import {
  type AuthzApi,
  type AuthzGrantsService,
  type AuthzLedgerBindingAttach,
  authzBindingIdentityKey,
  newAuthzGrantId,
} from "@langwatch/authz-contract";

import type { ScimGrantBindingScope, ScimGrantRecord } from "../repositories/scim.repository.ts";

/** The grant writes SCIM issues and the listings it reads its current slice from. */
export type ScimGrantAuthority = AuthzGrantsService &
  Pick<AuthzApi, "listUserBindings" | "listGroupBindings" | "listUserAndGroupBindings">;

/** What the directory says this principal should hold, minus the ids. */
export type DesiredScimGrant = {
  principal: AuthzLedgerBindingAttach["principal"];
  role: AuthzLedgerBindingAttach["role"];
  customRoleId: AuthzLedgerBindingAttach["customRoleId"];
  scopeType: AuthzLedgerBindingAttach["scopeType"];
  scopeId: AuthzLedgerBindingAttach["scopeId"];
};

function grantPrincipal(grant: {
  userId?: string | null;
  groupId?: string | null;
  apiKeyId?: string | null;
}): { userId: string } | { groupId: string } | { apiKeyId: string } {
  if (grant.userId) return { userId: grant.userId };
  if (grant.groupId) return { groupId: grant.groupId };
  if (grant.apiKeyId) return { apiKeyId: grant.apiKeyId };
  throw new Error("a SCIM grant names no principal");
}

/**
 * A grant's identity as the projection's partial unique indexes define it -
 * `authzBindingIdentityKey` (@langwatch/authz-contract). Two rows with the same key
 * are the same grant, whatever their row ids.
 */
function grantKey(grant: {
  userId?: string | null;
  groupId?: string | null;
  apiKeyId?: string | null;
  scopeType: string;
  scopeId: string;
  role: string;
  customRoleId: string | null;
}): string {
  const principal = grantPrincipal(grant);

  return authzBindingIdentityKey({
    principal,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    role: grant.role,
    customRoleId: grant.customRoleId,
  });
}

function keyOfDesired(grant: DesiredScimGrant): string {
  const principal = grant.principal;

  return grantKey({
    userId: "userId" in principal ? principal.userId : null,
    groupId: "groupId" in principal ? principal.groupId : null,
    apiKeyId: "apiKeyId" in principal ? principal.apiKeyId : null,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    role: grant.role,
    customRoleId: grant.customRoleId,
  });
}

/**
 * Bring the grants in the stated SCIM-owned scope in line with `desired`.
 *
 * The scope is the slice of the projection this push is authoritative over — a
 * user's organization-scoped grants, every grant a departing member holds,
 * every grant a deleted group carried. Anything inside that slice and not in
 * `desired` is revoked; anything in `desired` and not already there is
 * attached. Nothing outside the slice is touched, so a group sync can never
 * revoke a grant an administrator made by hand at another scope.
 *
 * Answers what it changed, so a caller (or a test) can assert that a replayed
 * push changed nothing.
 */
export class ScimGrantsService {
  private constructor(private readonly grants: ScimGrantAuthority) {}

  static create(options: { grants: ScimGrantAuthority }): ScimGrantsService {
    return new ScimGrantsService(options.grants);
  }

  /** The grants this IdP statement is authoritative for, as authz lists them. */
  async findGrantRows(scope: ScimGrantBindingScope): Promise<ScimGrantRecord[]> {
    const { organizationId } = scope;
    const bindings =
      scope.kind === "group"
        ? await this.grants.listGroupBindings({ organizationId, groupId: scope.groupId })
        : await this.grants.listUserBindings({ organizationId, userId: scope.userId });
    return bindings
      .filter(
        (binding) =>
          binding.organizationId === organizationId &&
          (scope.kind !== "organization-membership" ||
            (binding.scopeType === "ORGANIZATION" && binding.scopeId === organizationId)),
      )
      .map(({ id, userId, groupId, apiKeyId, scopeType, scopeId, role, customRoleId }) => ({
        id,
        userId,
        groupId,
        apiKeyId,
        scopeType,
        scopeId,
        role,
        customRoleId,
      }));
  }

  /** The organization-scoped roles these SCIM-pushed groups of this person are mapped to. */
  async findDirectoryAssertedRoles({
    organizationId,
    userId,
    groupIds,
  }: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const bindings = await this.grants.listUserAndGroupBindings({ organizationId, userId, groupIds });
    return bindings
      .filter(
        (binding) =>
          binding.organizationId === organizationId &&
          binding.groupId !== null &&
          groupIds.includes(binding.groupId) &&
          binding.scopeType === "ORGANIZATION" &&
          binding.scopeId === organizationId,
      )
      .map((binding) => binding.role);
  }

  async reconcile(input: {
    scope: ScimGrantBindingScope;
    desired: DesiredScimGrant[];
    actor: LedgerActor;
  }): Promise<{ attached: number; revoked: number }> {
    const current = await this.findGrantRows(input.scope);

    const desiredKeys = new Set(input.desired.map(keyOfDesired));
    const currentKeys = new Set(current.map((row) => grantKey(row)));

    const toRevoke = current.filter((row) => !desiredKeys.has(grantKey(row))).map((row) => row.id);
    const toAttach = input.desired.filter((grant) => !currentKeys.has(keyOfDesired(grant)));

    if (toRevoke.length > 0) {
      await this.grants.revokeBindings({
        organizationId: input.scope.organizationId,
        bindingIds: toRevoke,
        actor: input.actor,
        reason: "removed by the identity provider",
      });
    }

    if (toAttach.length > 0) {
      await this.grants.attachBindings({
        organizationId: input.scope.organizationId,
        bindings: toAttach.map((grant) => ({
          ...grant,
          bindingId: newAuthzGrantId(),
        })),
        caller: { type: "system" },
        actor: input.actor,
        source: "scim",
        onDuplicate: "skip",
      });
    }

    return { attached: toAttach.length, revoked: toRevoke.length };
  }

  /** A group membership is not a grant write, so its change retires the cached grants itself. */
  async invalidateOrganization(input: { organizationId: string }): Promise<void> {
    await this.grants.invalidateOrganization(input);
  }

  /**
   * Group grants replace the direct membership grants older pushes minted, so
   * the directory's own organization-scoped grants for these people go. Only
   * the directory's: what an administrator gave by hand at the same scope is
   * outside the slice a push is authoritative over. Answers how many went.
   */
  async retireMembershipGrants(input: {
    organizationId: string;
    userIds: string[];
    actor: LedgerActor;
  }): Promise<number> {
    if (input.userIds.length === 0) {
      return 0;
    }

    return this.grants.retireDirectoryGrants({
      organizationId: input.organizationId,
      userIds: input.userIds,
      actor: input.actor,
      reason: "directory access is supplied by group membership",
    });
  }
}
