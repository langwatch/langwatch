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
import { STORED_PRINCIPAL_KIND } from "@langwatch/authz";
import {
  grantFactToCompatBinding,
  grantRowToFact,
  isBindingGrant,
} from "@langwatch/authz-server";
import { bindingIdentityKey } from "@langwatch/authz-server/migration";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  GrantsLedgerWriter,
  LedgerBindingAttach,
} from "~/server/app-layer/authz/ledger";
import { liveGrants } from "~/server/app-layer/authz/repositories/live-rows";

/** What the directory says this principal should hold, minus the ids. */
export type DesiredScimGrant = Omit<LedgerBindingAttach, "bindingId">;

/** Group grants replace the direct membership grants older SCIM pushes minted. */
export async function retireScimMembershipGrants({
  prisma,
  writer,
  organizationId,
  userIds,
  actor,
}: {
  prisma: PrismaClient;
  writer: GrantsLedgerWriter;
  organizationId: string;
  userIds: string[];
  actor: LedgerActor;
}): Promise<void> {
  if (userIds.length === 0) return;

  const grants = await liveGrants(prisma).findMany({
    where: {
      organizationId,
      principalType: "USER",
      principalId: { in: userIds },
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      source: "scim",
    },
    select: { id: true },
  });
  if (grants.length === 0) return;

  await writer.revokeBindings({
    organizationId,
    bindingIds: grants.map(({ id }) => id),
    actor,
    reason: "directory access is supplied by group membership",
  });
}

/**
 * A grant's identity as the projection's partial unique indexes define it -
 * `bindingIdentityKey` (@langwatch/authz-server). Two rows with the same key
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
  return bindingIdentityKey({
    principal: grant,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    role: grant.role,
    customRoleId: grant.customRoleId,
  });
}

function keyOfDesired(grant: DesiredScimGrant): string {
  return grantKey({
    userId: grant.principal.userId ?? null,
    groupId: grant.principal.groupId ?? null,
    apiKeyId: grant.principal.apiKeyId ?? null,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    role: grant.role,
    customRoleId: grant.customRoleId,
  });
}

type ScimGrantPrincipal = {
  type: "user" | "group" | "apiKey";
  id: string;
};

type ScimGrantFilter = {
  principal: ScimGrantPrincipal;
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
};

/**
 * Bring the grants matching `where` in line with `desired`.
 *
 * `where` is the slice of the projection this push is authoritative over — a
 * user's organization-scoped grants, every grant a departing member holds,
 * every grant a deleted group carried. Anything inside that slice and not in
 * `desired` is revoked; anything in `desired` and not already there is
 * attached. Nothing outside the slice is touched, so a group sync can never
 * revoke a grant an administrator made by hand at another scope.
 *
 * Answers what it changed, so a caller (or a test) can assert that a replayed
 * push changed nothing.
 */
export async function reconcileScimGrants({
  prisma,
  writer,
  organizationId,
  where,
  desired,
  actor,
  mintBindingId,
}: {
  prisma: PrismaClient;
  writer: GrantsLedgerWriter;
  organizationId: string;
  where: ScimGrantFilter;
  desired: DesiredScimGrant[];
  actor: LedgerActor;
  mintBindingId: () => string;
}): Promise<{ attached: number; revoked: number }> {
  const currentRows = await liveGrants(prisma).findMany({
    where: {
      organizationId,
      principalType: STORED_PRINCIPAL_KIND[where.principal.type],
      principalId: where.principal.id,
      ...(where.scopeType !== undefined && { scopeType: where.scopeType }),
      ...(where.scopeId !== undefined && { scopeId: where.scopeId }),
    },
  });
  const current = currentRows.flatMap((row) => {
    const grant = grantRowToFact(row);
    if (!isBindingGrant(grant)) return [];
    return [
      grantFactToCompatBinding({
        grant,
        organizationId: row.organizationId,
      }),
    ];
  });

  const desiredKeys = new Set(desired.map(keyOfDesired));
  const currentKeys = new Set(current.map((row) => grantKey(row)));

  const toRevoke = current
    .filter((row) => !desiredKeys.has(grantKey(row)))
    .map((row) => row.id);
  const toAttach = desired.filter(
    (grant) => !currentKeys.has(keyOfDesired(grant)),
  );

  if (toRevoke.length > 0) {
    await writer.revokeBindings({
      organizationId,
      bindingIds: toRevoke,
      actor,
      reason: "removed by the identity provider",
    });
  }
  if (toAttach.length > 0) {
    await writer.attachBindings({
      organizationId,
      bindings: toAttach.map((grant) => ({
        ...grant,
        bindingId: mintBindingId(),
      })),
      actor,
      source: "scim",
      onDuplicate: "skip",
    });
  }

  return { attached: toAttach.length, revoked: toRevoke.length };
}
