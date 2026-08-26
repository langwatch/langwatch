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
import type { LedgerActor } from "@langwatch/actor";
import {
  type AuthzGrantsService,
  type AuthzLedgerBindingAttach,
  authzBindingIdentityKey,
} from "@langwatch/authz-contract";
import { randomUUID } from "node:crypto";
import type {
  ScimGrantBindingScope,
  ScimGrantRepositoryPort,
} from "../ports/scim-repository.port";

/** What the directory says this principal should hold, minus the ids. */
export type DesiredScimGrant = {
  principal: AuthzLedgerBindingAttach["principal"];
  role: AuthzLedgerBindingAttach["role"];
  customRoleId: AuthzLedgerBindingAttach["customRoleId"];
  scopeType: AuthzLedgerBindingAttach["scopeType"];
  scopeId: AuthzLedgerBindingAttach["scopeId"];
};

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
  const principal = grant.userId
    ? ({ userId: grant.userId } as const)
    : grant.groupId
      ? ({ groupId: grant.groupId } as const)
      : grant.apiKeyId
        ? ({ apiKeyId: grant.apiKeyId } as const)
        : null;
  if (!principal) {
    throw new Error("a SCIM grant names no principal");
  }
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
  private constructor(
    private readonly repository: ScimGrantRepositoryPort,
    private readonly grants: AuthzGrantsService,
  ) {}

  static create(options: {
    repository: ScimGrantRepositoryPort;
    grants: AuthzGrantsService;
  }): ScimGrantsService {
    return new ScimGrantsService(options.repository, options.grants);
  }

  async reconcile(input: {
    scope: ScimGrantBindingScope;
    desired: DesiredScimGrant[];
    actor: LedgerActor;
  }): Promise<{ attached: number; revoked: number }> {
    const current = await this.repository.listRoleBindings(input.scope);

    const desiredKeys = new Set(input.desired.map(keyOfDesired));
    const currentKeys = new Set(current.map((row) => grantKey(row)));

    const toRevoke = current
      .filter((row) => !desiredKeys.has(grantKey(row)))
      .map((row) => row.id);
    const toAttach = input.desired.filter(
      (grant) => !currentKeys.has(keyOfDesired(grant)),
    );

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
          bindingId: `rolebinding_${randomUUID()}`,
        })),
        actor: input.actor,
        source: "scim",
        onDuplicate: "skip",
      });
    }

    return { attached: toAttach.length, revoked: toRevoke.length };
  }
}
