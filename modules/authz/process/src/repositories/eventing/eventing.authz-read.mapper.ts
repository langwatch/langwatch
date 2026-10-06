// The grant-head rows a decision reads, translated one way whichever backing read them.
import type { BindingRoleKey, CollectedBinding, GrantScopeTier } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import type { ShareLinkRow } from "../authz-read.repository.ts";
import { SHARE_VISIBILITY_BY_PRINCIPAL_DB } from "../prisma/prisma.authz-grant.mapper.ts";

export const SYSTEM_API_KEY_ROLE_KIND = "system_api_key" as const;

/** The three scope tiers a `CollectedBinding` can carry. RESOURCE rows are
 *  the share tier (findShareLinks) and PLATFORM rows are dormant facts that
 *  no PR-3 decision reads, so neither belongs in a binding list. */
export const BINDING_SCOPE_TYPES: readonly GrantScopeTier[] = ["ORGANIZATION", "TEAM", "PROJECT"];

export type BindingGrantRow = {
  roleKey: string | null;
  scopeType: string;
  scopeId: string;
  expiresAt: Instant | null;
};

/** The columns a share-link check selects off `Grant`. */
export type ShareLinkGrantCandidateRow = {
  id: string;
  principalType: string;
  resourceKind: string | null;
  scopeId: string;
  projectId: string | null;
  expiresAt: Instant | null;
  maxViews: number | null;
};

/** Who holds a grant naming a role, as `rolesExclusiveToApiKey` reads it. */
export type RoleHolderRow = {
  roleKey: string | null;
  principalType: string;
  principalId: string | null;
};

export function isBindingScope(scopeType: string): scopeType is GrantScopeTier {
  return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
}

/** A role key a decision can represent: a built-in, or `custom:` naming a role. */
export function isBindingRoleKey(roleKey: string | null): roleKey is BindingRoleKey {
  if (roleKey === "admin" || roleKey === "member" || roleKey === "viewer") return true;
  return roleKey?.startsWith("custom:") === true && roleKey.length > "custom:".length;
}

/** Only the role keys a decision can represent. Dormant facts such as
 * lite-member stay migration data instead of becoming permissions. */
export function collectBindings<TRow extends BindingGrantRow>({
  rows,
  viaGroupId,
}: {
  rows: readonly TRow[];
  viaGroupId: (row: TRow) => string | null;
}): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  for (const row of rows) {
    if (!isBindingScope(row.scopeType)) continue;
    const { roleKey } = row;
    if (!isBindingRoleKey(roleKey)) continue;
    // Reported, never filtered: whether an elapsed end still grants is the collector's call.
    const expiresAtMs = row.expiresAt?.epochMilliseconds;
    bindings.push({
      roleKey,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      viaGroupId: viaGroupId(row),
      ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    });
  }
  return bindings;
}

/**
 * Role ids this API key alone holds a grant for. `some` matters as much as
 * `every`: `every` is vacuously true over an empty relation, so a system role
 * with NO grants would be readable by any key.
 */
export function rolesExclusiveTo({
  holders,
  apiKeyId,
}: {
  holders: readonly RoleHolderRow[];
  apiKeyId: string;
}): Set<string> {
  const held = new Map<string, { isMine: boolean; isForeign: boolean }>();
  for (const holder of holders) {
    const { roleKey } = holder;
    if (!isBindingRoleKey(roleKey) || !roleKey.startsWith("custom:")) continue;
    const customRoleId = roleKey.slice("custom:".length);
    const entry = held.get(customRoleId) ?? { isMine: false, isForeign: false };
    if (holder.principalType === "API_KEY" && holder.principalId === apiKeyId) {
      entry.isMine = true;
    } else {
      entry.isForeign = true;
    }
    held.set(customRoleId, entry);
  }
  return new Set(
    [...held.entries()]
      .filter(([, entry]) => entry.isMine && !entry.isForeign)
      .map(([roleId]) => roleId),
  );
}

export function shareLinkRowFrom({
  row,
  viewCounts,
}: {
  row: ShareLinkGrantCandidateRow;
  viewCounts: Map<string, number>;
}): ShareLinkRow[] {
  const visibility = SHARE_VISIBILITY_BY_PRINCIPAL_DB[row.principalType];
  if (!visibility) return [];
  if (row.resourceKind !== "TRACE" && row.resourceKind !== "THREAD") {
    return [];
  }
  if (row.projectId == null) return [];
  return [
    {
      resourceType: row.resourceKind,
      resourceId: row.scopeId,
      projectId: row.projectId,
      visibility,
      expiresAt: row.expiresAt,
      maxViews: row.maxViews,
      viewCount: viewCounts.get(row.id) ?? 0,
    },
  ];
}
