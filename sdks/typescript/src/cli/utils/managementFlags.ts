/**
 * The flag grammar the management commands share.
 *
 * The management APIs take structured values a single `--flag value` cannot
 * carry: a permission is a resource and an action, a binding is a role and a
 * scope. Rather than invent a per-command spelling for each, the CLI uses one
 * colon-separated shape per concept and repeats the flag, which is the
 * convention the rest of the CLI already uses for lists (`--project-id` on
 * `api-keys create`).
 *
 * Every parser refuses a malformed value by NAMING the expected shape: a
 * message that says only "invalid" leaves the caller guessing at a grammar the
 * help text describes in one line.
 *
 * Parsing is pure and separate from the commands so it can be tested directly,
 * and so a command's failure is a validation error rather than a request the
 * platform has to reject. The invite grammar, the one shape with a JSON
 * spelling as well as a flag one, lives in `managementInvites`.
 */
import {
  MANAGEMENT_ROLES,
  MANAGEMENT_SCOPE_TYPES,
  type ManagementBindingInput,
  type ManagementRole,
  type ManagementScopeType,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from "@/client-sdk/services/_shared/management-types";
import type { ListRoleBindingsOptions } from "@/client-sdk/services/role-bindings/role-bindings-api.service";

/** A flag value the CLI refuses before it ever reaches the platform. */
export class ManagementFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementFlagError";
  }
}

/** The tail of every "Expected one of ..." refusal. */
export const oneOf = (values: readonly string[]): string => values.join(", ");

/**
 * A non-negative integer flag, refused by name rather than sent as NaN.
 *
 * Matched as plain decimal digits rather than run through `Number`, which
 * reads "" as 0, "0x10" as 16 and "1e3" as 1000: a page size nobody typed.
 * Digits alone are not enough either, because past 2^53 a decimal string
 * rounds to a different integer and long enough becomes Infinity, so the
 * request would carry a number the caller never asked for.
 */
export const parseCount = ({
  value,
  flag,
}: {
  value: string;
  flag: string;
}): number => {
  const trimmed = value.trim();
  const count = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(count)) {
    throw new ManagementFlagError(
      `Invalid ${flag} "${value}". Expected a whole number.`,
    );
  }
  return count;
};

/**
 * `resource:action`, repeated. The set keeps the order the flags were given so
 * a caller can read their own command back off the request, and a repeated
 * pair collapses rather than being sent twice.
 */
export const parsePermissionFlags = (values: string[] = []): string[] => {
  const permissions: string[] = [];
  for (const value of values) {
    const parts = value.split(":");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new ManagementFlagError(
        `Invalid permission "${value}". Expected resource:action, for example project:view.`,
      );
    }
    const permission = `${parts[0].trim()}:${parts[1].trim()}`;
    if (!permissions.includes(permission)) permissions.push(permission);
  }
  return permissions;
};

/**
 * A role read out of a compound value, where `source` names which of the
 * several roles one command can carry was the wrong one.
 */
export const parseRoleIn = ({
  value,
  source,
}: {
  value: string;
  source: string;
}): ManagementRole => {
  const role = value.trim().toUpperCase();
  if (!(MANAGEMENT_ROLES as readonly string[]).includes(role)) {
    throw new ManagementFlagError(
      `Invalid role "${value}" in ${source}. Expected one of ${oneOf(MANAGEMENT_ROLES)}.`,
    );
  }
  return role as ManagementRole;
};

const assertScopeType = ({
  value,
  source,
}: {
  value: string;
  source: string;
}): ManagementScopeType => {
  const scopeType = value.trim().toUpperCase();
  if (!(MANAGEMENT_SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    throw new ManagementFlagError(
      `Invalid scope type "${value}" in ${source}. Expected one of ${oneOf(MANAGEMENT_SCOPE_TYPES)}.`,
    );
  }
  return scopeType as ManagementScopeType;
};

/** The organization role a member or an invite holds. */
export const parseOrganizationRole = (value: string): OrganizationRole => {
  const role = value.trim().toUpperCase();
  if (!(ORGANIZATION_ROLES as readonly string[]).includes(role)) {
    throw new ManagementFlagError(
      `Invalid organization role "${value}". Expected one of ${oneOf(ORGANIZATION_ROLES)}.`,
    );
  }
  return role as OrganizationRole;
};

/** A role a binding grants, given on its own flag. */
export const parseRole = (value: string): ManagementRole =>
  parseRoleIn({ value, source: "--role" });

/** A scope type given on its own flag. */
export const parseScopeType = (value: string): ManagementScopeType =>
  assertScopeType({ value, source: "--scope-type" });

/**
 * `role:scopeType:scopeId`, repeated: what an API key may do, and where.
 * Scope ids never contain a colon, so the three parts are unambiguous.
 */
export const parseBindingFlags = (
  values: string[] = [],
): ManagementBindingInput[] =>
  values.map((value) => {
    const parts = value.split(":");
    if (parts.length !== 3 || parts.some((part) => !part.trim())) {
      throw new ManagementFlagError(
        `Invalid binding "${value}". Expected role:scopeType:scopeId, for example ADMIN:PROJECT:project_abc.`,
      );
    }
    return {
      role: parseRoleIn({ value: parts[0]!, source: `binding "${value}"` }),
      scopeType: assertScopeType({
        value: parts[1]!,
        source: `binding "${value}"`,
      }),
      scopeId: parts[2]!.trim(),
    };
  });

export interface RoleBindingFilterFlags {
  principalType?: string;
  principalId?: string;
  scopeType?: string;
  scopeId?: string;
  offset?: string;
  limit?: string;
}

/** The principal kinds `role-bindings list` and `create` accept. */
export const ROLE_BINDING_PRINCIPAL_FLAGS = [
  "user",
  "group",
  "api-key",
] as const;

export type RoleBindingPrincipalFlag =
  (typeof ROLE_BINDING_PRINCIPAL_FLAGS)[number];

/** The request field a principal type names. */
const PRINCIPAL_FIELD = {
  user: "userId",
  group: "groupId",
  "api-key": "apiKeyId",
} as const satisfies Record<RoleBindingPrincipalFlag, string>;

export const parsePrincipalType = (value: string): RoleBindingPrincipalFlag => {
  const principalType = value.trim().toLowerCase();
  if (
    !(ROLE_BINDING_PRINCIPAL_FLAGS as readonly string[]).includes(principalType)
  ) {
    throw new ManagementFlagError(
      `Invalid principal type "${value}". Expected one of ${oneOf(ROLE_BINDING_PRINCIPAL_FLAGS)}.`,
    );
  }
  return principalType as RoleBindingPrincipalFlag;
};

/**
 * The filters a role-bindings listing sends.
 *
 * A filter the caller did not give is ABSENT from the result, never present
 * and empty: an empty string is a filter that matches nothing, which would
 * turn "no filter" into "no results".
 */
export const composeRoleBindingFilters = (
  flags: RoleBindingFilterFlags,
): ListRoleBindingsOptions => {
  const filters: ListRoleBindingsOptions = {};

  if (flags.principalId !== undefined) {
    if (flags.principalType === undefined) {
      throw new ManagementFlagError(
        `--principal-id needs --principal-type to say what it names. Expected one of ${oneOf(ROLE_BINDING_PRINCIPAL_FLAGS)}.`,
      );
    }
    filters[PRINCIPAL_FIELD[parsePrincipalType(flags.principalType)]] =
      flags.principalId;
  } else if (flags.principalType !== undefined) {
    throw new ManagementFlagError(
      "--principal-type needs --principal-id to say which principal it names.",
    );
  }
  if (flags.scopeType !== undefined) {
    filters.scopeType = parseScopeType(flags.scopeType);
  }
  if (flags.scopeId !== undefined) filters.scopeId = flags.scopeId;
  if (flags.offset !== undefined) {
    filters.offset = parseCount({ value: flags.offset, flag: "--offset" });
  }
  if (flags.limit !== undefined) {
    filters.limit = parseCount({ value: flags.limit, flag: "--limit" });
  }

  return filters;
};

/** The principal half of a role-binding create, as one request field. */
export const composeRoleBindingPrincipal = ({
  principalType,
  principalId,
}: {
  principalType: string;
  principalId: string;
}): Record<string, string> => ({
  [PRINCIPAL_FIELD[parsePrincipalType(principalType)]]: principalId,
});

/** The permission modes `api-keys create` and `update` accept on the wire. */
export const API_KEY_PERMISSION_MODE_FLAGS = [
  "all",
  "readonly",
  "restricted",
] as const;

export type ApiKeyPermissionModeFlag =
  (typeof API_KEY_PERMISSION_MODE_FLAGS)[number];

export const parsePermissionMode = (
  value: string,
): ApiKeyPermissionModeFlag => {
  const mode = value.trim().toLowerCase();
  if (!(API_KEY_PERMISSION_MODE_FLAGS as readonly string[]).includes(mode)) {
    throw new ManagementFlagError(
      `Invalid permission mode "${value}". Expected one of ${oneOf(API_KEY_PERMISSION_MODE_FLAGS)}.`,
    );
  }
  return mode as ApiKeyPermissionModeFlag;
};
