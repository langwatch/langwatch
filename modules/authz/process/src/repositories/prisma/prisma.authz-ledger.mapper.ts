import {
  roleKeyForTeamRole,
  type TeamUserRole as AuthzTeamUserRole,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";

import type {
  AuthzRoleBindingFilter,
  LedgerBindingAttach,
} from "../../eventing/authz-grant.store.ts";
import type { BindingPrincipalWhere, RoleBindingWrite } from "../authz-grant.repository.ts";
import { PRINCIPAL_TO_DB } from "./prisma.authz-grant.mapper.ts";

const storedIdSchema = z.object({ id: z.string() });
const storedRoleKeySchema = z.object({ roleKey: z.string().nullable() });

export type AuthzGrantFilter = Record<string, unknown> & {
  principalType?: unknown;
  principalId?: unknown;
  roleKey?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  id?: unknown;
  organizationId?: unknown;
};

/** A compat binding filter as the Grant-head predicate it names, or the outcome that it names
 *  none. */
export type GrantWhereTranslation =
  | { kind: "translated"; where: AuthzGrantFilter }
  | { kind: "untranslatable" };

const UNTRANSLATABLE: { kind: "untranslatable" } = { kind: "untranslatable" };

/** The ledger's command vocabulary over one binding fact. */
/** Decision 23: user-action paths mint a random command id; retries reuse it. */
export function newCommandId(): string {
  return generate("authzcmd").toString();
}

/** The id of a live grant row read with `select: { id: true }`. */
export function storedId(row: unknown): string {
  return storedIdSchema.parse(row).id;
}

/** Whether a live grant row, if there is one, carries this role key. */
export function carriesRoleKey({ row, roleKey }: { row: unknown; roleKey: string }): boolean {
  return row != null && storedRoleKeySchema.parse(row).roleKey === roleKey;
}

/**
 * A binding's identity as the canonical `Grant` head stores it. What the
 * read-your-writes hold matches on beside the id, so a row carrying the id
 * but somebody else's principal, role or scope cannot confirm this write.
 */
export function grantIdentityWhere(binding: LedgerBindingAttach): {
  principalType: string;
  principalId: string;
  roleKey: string;
  scopeType: string;
  scopeId: string;
} {
  const principal = principalForWhere(binding.principal);

  return {
    principalType: PRINCIPAL_TO_DB[principal.type],
    principalId: principal.id,
    roleKey: roleKeyFor(binding),
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

/**
 * Whether a stored permission payload is exactly the list just written. The
 * column is JSON, so anything that is not an array of the same strings in the
 * same order is a row the fold has not landed yet.
 */
export function samePermissions({
  stored,
  wanted,
}: {
  stored: unknown;
  wanted: string[];
}): boolean {
  return (
    Array.isArray(stored) &&
    stored.length === wanted.length &&
    wanted.every((permission, index) => stored[index] === permission)
  );
}

/** The partial unique indexes refusing an identical binding. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/** Prisma's "record to update not found". */
export function isRecordNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2025";
}

export function roleKeyFor({
  role,
  customRoleId,
}: {
  role: RoleBindingWrite["role"];
  customRoleId: string | null;
}): string {
  return customRoleId === null
    ? roleKeyForTeamRole(role as AuthzTeamUserRole)
    : `custom:${customRoleId}`;
}

export function principalForWhere(principal: BindingPrincipalWhere): {
  type: "user" | "group" | "apiKey";
  id: string;
} {
  if (principal.userId !== undefined) {
    return { type: "user", id: principal.userId };
  }
  if (principal.groupId !== undefined) {
    return { type: "group", id: principal.groupId };
  }
  return { type: "apiKey", id: principal.apiKeyId };
}

/**
 * Translate a compat `RoleBinding` filter into the equivalent `Grant`-head predicate, so a
 * filtered revoke reaches Grant rows the compat head never represented (a `roleKey`-only
 * import, a PLATFORM-tier row). The three compat tiers spell identically in `GrantScopeType`.
 */
export function grantWhereFromBindingWhere(
  where: AuthzRoleBindingFilter,
  organizationId: string,
): GrantWhereTranslation {
  const known = new Set([
    "apiKeyId",
    "groupId",
    "userId",
    "customRoleId",
    "scopeType",
    "scopeId",
    "id",
    "organizationId",
  ]);
  const keys = Object.keys(where);
  if (keys.some((key) => !known.has(key))) return UNTRANSLATABLE;

  const grantWhere: AuthzGrantFilter = { organizationId };

  for (const field of ["scopeType", "scopeId"] as const) {
    const value = where[field];
    if (value == null) continue;
    if (typeof value !== "string") return UNTRANSLATABLE;
    grantWhere[field] = value;
  }

  const principal = (
    [
      ["apiKeyId", "API_KEY"],
      ["groupId", "GROUP"],
      ["userId", "USER"],
    ] as const
  ).find(([field]) => where[field] != null);
  if (principal) {
    const value = where[principal[0]];
    // Only a plain-string principal id is translated; an operator shape here
    // is outside the caller vocabulary, so bail rather than guess.
    if (typeof value !== "string") return UNTRANSLATABLE;
    grantWhere.principalType = principal[1];
    grantWhere.principalId = value;
  }

  if (where.customRoleId != null) {
    const roleKey = roleKeyFromCustomRoleFilter(where.customRoleId);
    if (roleKey.kind === "untranslatable") return UNTRANSLATABLE;
    grantWhere.roleKey = roleKey.roleKey;
  }

  if (where.id != null) grantWhere.id = where.id;

  return { kind: "translated", where: grantWhere };
}

/** A `customRoleId` filter as the `custom:<id>` roleKey predicate it names —
 *  a plain string or an `in` list; any other operator shape is outside the
 *  caller vocabulary, so the caller bails. */
function roleKeyFromCustomRoleFilter(
  value: NonNullable<AuthzRoleBindingFilter["customRoleId"]>,
): { kind: "translated"; roleKey: string | { in: string[] } } | { kind: "untranslatable" } {
  if (typeof value === "string") return { kind: "translated", roleKey: `custom:${value}` };
  if (typeof value !== "object" || value === null) return UNTRANSLATABLE;
  if (!("in" in value)) return UNTRANSLATABLE;
  const ids = value.in;
  if (!Array.isArray(ids)) return UNTRANSLATABLE;
  return { kind: "translated", roleKey: { in: ids.map((id) => `custom:${id}`) } };
}
