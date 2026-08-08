/**
 * The flag grammar the management commands share.
 *
 * The management APIs take structured values a single `--flag value` cannot
 * carry: a permission is a resource and an action, a binding is a role and a
 * scope, an invite is a person plus the teams they land on. Rather than invent
 * a per-command spelling for each, the CLI uses one colon-separated shape per
 * concept and repeats the flag, which is the convention the rest of the CLI
 * already uses for lists (`--project-id` on `api-keys create`).
 *
 * Every parser refuses a malformed value by NAMING the expected shape: a
 * message that says only "invalid" leaves the caller guessing at a grammar the
 * help text describes in one line.
 *
 * Parsing is pure and separate from the commands so it can be tested directly,
 * and so a command's failure is a validation error rather than a request the
 * platform has to reject.
 */
import {
  MANAGEMENT_ROLES,
  MANAGEMENT_SCOPE_TYPES,
  ORGANIZATION_ROLES,
  type ManagementBindingInput,
  type ManagementRole,
  type ManagementScopeType,
  type OrganizationRole,
} from "@/client-sdk/services/_shared/management-types";
import type { InviteInput } from "@/client-sdk/services/organization/organization-api.service";
import type { ListRoleBindingsOptions } from "@/client-sdk/services/role-bindings/role-bindings-api.service";

/** A flag value the CLI refuses before it ever reaches the platform. */
export class ManagementFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementFlagError";
  }
}

const oneOf = (values: readonly string[]): string => values.join(", ");

/**
 * A non-negative integer flag, refused by name rather than sent as NaN.
 *
 * Matched as plain decimal digits rather than run through `Number`, which
 * reads "" as 0, "0x10" as 16 and "1e3" as 1000: a page size nobody typed.
 */
export const parseCount = (value: string, flag: string): number => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ManagementFlagError(
      `Invalid ${flag} "${value}". Expected a whole number.`,
    );
  }
  return Number(trimmed);
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

const assertRole = (value: string, source: string): ManagementRole => {
  const role = value.trim().toUpperCase();
  if (!(MANAGEMENT_ROLES as readonly string[]).includes(role)) {
    throw new ManagementFlagError(
      `Invalid role "${value}" in ${source}. Expected one of ${oneOf(MANAGEMENT_ROLES)}.`,
    );
  }
  return role as ManagementRole;
};

const assertScopeType = (
  value: string,
  source: string,
): ManagementScopeType => {
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
  assertRole(value, "--role");

/** A scope type given on its own flag. */
export const parseScopeType = (value: string): ManagementScopeType =>
  assertScopeType(value, "--scope-type");

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
      role: assertRole(parts[0]!, `binding "${value}"`),
      scopeType: assertScopeType(parts[1]!, `binding "${value}"`),
      scopeId: parts[2]!.trim(),
    };
  });

/**
 * `teamId:role`, repeated: the teams an invited person lands on and the role
 * they hold there. A team id never contains a colon.
 */
export const parseTeamFlags = (
  values: string[] = [],
): Array<{ teamId: string; role: ManagementRole }> =>
  values.map((value) => {
    const parts = value.split(":");
    if (parts.length !== 2 || parts.some((part) => !part.trim())) {
      throw new ManagementFlagError(
        `Invalid team assignment "${value}". Expected teamId:role, for example team_abc:MEMBER.`,
      );
    }
    return {
      teamId: parts[0]!.trim(),
      role: assertRole(parts[1]!, `team assignment "${value}"`),
    };
  });

export interface InviteFlagInput {
  /** Repeatable `--email`. */
  email?: string[];
  /** Repeatable `--role`; one per email, or one for the whole batch. */
  role?: string[];
  /** Repeatable `--team teamId:role`, applied to every invite in the batch. */
  team?: string[];
}

/**
 * The invite batch the flags describe.
 *
 * One `--role` covers the whole batch; several must line up one-per-email, so
 * a mismatch is caught here rather than silently pairing the wrong role with
 * the wrong person. The team assignments apply to every invite in the batch:
 * an invite with per-person teams is a JSON batch, which the same command
 * accepts through `--json`, `--file` or `--stdin`.
 */
export const composeInvitesFromFlags = (
  options: InviteFlagInput,
): InviteInput[] => {
  const emails = (options.email ?? []).map((email) => email.trim()).filter(Boolean);
  if (emails.length === 0) {
    throw new ManagementFlagError(
      "No invites given. Pass --email (repeatable) with --role and --team, or a JSON batch with --json, --file or --stdin.",
    );
  }

  const roles = options.role ?? [];
  if (roles.length !== 1 && roles.length !== emails.length) {
    throw new ManagementFlagError(
      `Got ${emails.length} email flags and ${roles.length} role flags. Pass one --role for the whole batch, or one per --email.`,
    );
  }

  const teams = parseTeamFlags(options.team);
  if (teams.length === 0) {
    throw new ManagementFlagError(
      "Every invite needs at least one team. Pass --team teamId:role (repeatable).",
    );
  }

  return emails.map((email, index) => ({
    email,
    role: parseOrganizationRole(roles.length === 1 ? roles[0]! : roles[index]!),
    teams: teams.map((team) => ({ teamId: team.teamId, role: team.role })),
  }));
};

/** A custom role id out of a JSON batch, or undefined when none was given. */
const parseCustomRoleId = ({
  value,
  source,
}: {
  value: unknown;
  source: string;
}): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ManagementFlagError(
      `${source} has a customRoleId that is not a role id. Expected the id of a custom role.`,
    );
  }
  return value.trim();
};

/**
 * The invite batch a JSON document describes. Both the bare array and the
 * `{ invites: [...] }` envelope are accepted, because the first is what a
 * person writes and the second is what the API answers with, and pasting back
 * a previous response is the obvious thing to try.
 */
export const parseInvitesJson = (raw: string): InviteInput[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManagementFlagError(
      "Invalid JSON: could not parse the invite batch.",
    );
  }

  const invites = Array.isArray(parsed)
    ? parsed
    : (parsed as { invites?: unknown } | null)?.invites;

  if (!Array.isArray(invites)) {
    throw new ManagementFlagError(
      'Invalid invite batch: expected a JSON array of invites, or an object with an "invites" array.',
    );
  }
  if (invites.length === 0) {
    throw new ManagementFlagError(
      "Invalid invite batch: the invites array is empty.",
    );
  }

  return invites.map((entry, index) => {
    const invite = entry as Partial<InviteInput> | null;
    if (!invite || typeof invite.email !== "string" || !invite.email.trim()) {
      throw new ManagementFlagError(
        `Invite ${index + 1} has no email. Every invite needs email, role and teams.`,
      );
    }
    if (typeof invite.role !== "string") {
      throw new ManagementFlagError(
        `Invite ${index + 1} ("${invite.email}") has no role. Expected one of ${oneOf(ORGANIZATION_ROLES)}.`,
      );
    }
    const teams = invite.teams;
    if (!Array.isArray(teams) || teams.length === 0) {
      throw new ManagementFlagError(
        `Invite ${index + 1} ("${invite.email}") has no teams. Every invite needs at least one team assignment.`,
      );
    }
    return {
      email: invite.email.trim(),
      role: parseOrganizationRole(invite.role),
      teams: teams.map((team, teamIndex) => {
        const assignment = team as Partial<InviteInput["teams"][number]> | null;
        if (
          !assignment ||
          typeof assignment.teamId !== "string" ||
          !assignment.teamId.trim()
        ) {
          throw new ManagementFlagError(
            `Invite ${index + 1} ("${invite.email}") team ${teamIndex + 1} has no teamId.`,
          );
        }
        const customRoleId = parseCustomRoleId({
          value: assignment.customRoleId,
          source: `Invite ${index + 1} ("${invite.email}") team ${teamIndex + 1}`,
        });
        return {
          teamId: assignment.teamId.trim(),
          role: assertRole(
            typeof assignment.role === "string" ? assignment.role : "",
            `invite ${index + 1} team ${teamIndex + 1}`,
          ),
          ...(customRoleId !== undefined ? { customRoleId } : {}),
        };
      }),
    };
  });
};

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
  if (flags.offset !== undefined) filters.offset = parseCount(flags.offset, "--offset");
  if (flags.limit !== undefined) filters.limit = parseCount(flags.limit, "--limit");

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
