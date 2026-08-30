import {
  isOrgExclusivePermission,
  isRegistryPermission,
} from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import { batchTeamsPermissions, type Permission } from "~/server/api/rbac";
import { ApiKeyService, type CustomRoleBindingInput } from "./api-key.service";
import { defaultCliKeyPermissions } from "./cli-key-defaults";
import { ApiKeyAlreadyRevokedError, ApiKeyNotFoundError } from "./errors";

const logger = createLogger("langwatch:api-key:cli-login-key");

/**
 * The marker that, together with `createdByDeviceLabel`, identifies a key the
 * device-flow login minted. Re-login from the same device revokes the previous
 * key by this pair before minting the next one, so logins never accumulate
 * credentials.
 */
export const CLI_LOGIN_KEY_NAME_PREFIX = "CLI login - ";

/** The device label stamped when an older CLI sends no client_info. */
export const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

export type CliKeyScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface CliKeyBindingSelection {
  scopeType: CliKeyScopeType;
  scopeId: string;
}

/**
 * The scope + permission selection the authorize screen approves. Stamped on
 * the Redis device-code record at /approve time; consumed by the /exchange
 * mint. Carries no role — the minted bindings are always CUSTOM with the
 * selected permission list.
 */
export interface CliKeySelection {
  bindings: CliKeyBindingSelection[];
  permissions: string[];
}

/** The reach of a minted CLI login key, shipped to the CLI at exchange. */
export interface CliKeyScopeSummary {
  kind: "organization" | "projects";
  projectIds: string[];
}

/**
 * An approve request carried a selection the server cannot stamp: empty
 * bindings, empty permissions, or a permission the registry does not know.
 * `meta.fieldErrors` names the offending field so the authorize screen can
 * mark it in place.
 */
export class CliKeySelectionInvalidError extends HandledError {
  declare readonly code: "cli_key_selection_invalid";

  constructor(fieldErrors: Record<string, string[]>) {
    super("cli_key_selection_invalid", "The key selection is not valid", {
      httpStatus: 422,
      meta: { fieldErrors },
    });
    this.name = "CliKeySelectionInvalidError";
  }
}

/**
 * Mints, replaces and revokes the user-scoped API key a `langwatch login`
 * device session carries, and resolves the selection that shapes it.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
export class CliLoginKeyService {
  private readonly prisma: PrismaClient;
  private readonly apiKeyService: ApiKeyService;

  constructor({
    prisma,
    apiKeyService,
  }: {
    prisma: PrismaClient;
    apiKeyService: ApiKeyService;
  }) {
    this.prisma = prisma;
    this.apiKeyService = apiKeyService;
  }

  static create(prisma: PrismaClient): CliLoginKeyService {
    return new CliLoginKeyService({
      prisma,
      apiKeyService: ApiKeyService.create(prisma),
    });
  }

  /**
   * Validates an explicit selection from the authorize screen and returns the
   * normalized form to stamp.
   *
   * Refusals, all before anything is stamped:
   *   - zero bindings / zero permissions / unknown permissions →
   *     {@link CliKeySelectionInvalidError} with `meta.fieldErrors`
   *   - scopes outside the organization, bindings above the approving user's
   *     own ceiling, personal teams the approver does not own →
   *     `ApiKeyScopeViolationError` / `PersonalWorkspaceNotManagedHereError`
   *     from the same checks `ApiKeyService.create` runs at mint time.
   *
   * Org-exclusive permissions are FILTERED, not refused, when the selection
   * carries no ORGANIZATION binding: a team- or project-scoped binding can
   * never grant them (ADR-021), so keeping them on the key would only store a
   * list the resolver ignores. The same filter shapes the default selection,
   * so the two paths agree.
   */
  async validateSelection({
    userId,
    organizationId,
    selection,
  }: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection> {
    const bindings = dedupeBindings(selection.bindings);
    if (bindings.length === 0) {
      throw new CliKeySelectionInvalidError({
        bindings: ["Select at least one scope"],
      });
    }

    const unknown = selection.permissions.filter(
      (permission) => !isRegistryPermission(permission),
    );
    if (unknown.length > 0) {
      throw new CliKeySelectionInvalidError({
        permissions: unknown.map(
          (permission) => `Unknown permission "${permission}"`,
        ),
      });
    }

    const permissions = filterToGrantable({
      permissions: [...new Set(selection.permissions)],
      bindings,
    });
    if (permissions.length === 0) {
      throw new CliKeySelectionInvalidError({
        permissions: ["Select at least one permission"],
      });
    }

    await this.apiKeyService.assertSelectionWithinCeiling({
      userId,
      organizationId,
      bindings: asCustomBindings(bindings),
      permissions,
    });

    return { bindings, permissions: permissions.sort() };
  }

  /**
   * The selection stamped when a client approves without an explicit one:
   * the widest scope the user holds, with the default permission list
   * narrowed to what they really hold there.
   *
   *   - org-scope ADMIN role binding → one ORGANIZATION binding, full
   *     `defaultCliKeyPermissions()` (an org admin holds all of them).
   *   - otherwise → TEAM bindings for the user's teams (their personal
   *     workspace included), permissions = the default list minus
   *     org-exclusive ones, intersected across those teams. A team where the
   *     user holds none of them is dropped rather than zeroing the whole key.
   *
   * Returns null when nothing mintable remains — the login then completes
   * without a scoped key, exactly like a pre-selection client.
   */
  async resolveDefaultSelection({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null> {
    const defaults = defaultCliKeyPermissions();

    if (await this.apiKeyService.isOrgAdmin({ userId, organizationId })) {
      return {
        bindings: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        permissions: [...defaults].sort(),
      };
    }

    const teamIdsOfUser = await this.teamsTheUserCanScopeTo({
      userId,
      organizationId,
    });
    if (teamIdsOfUser.length === 0) return null;

    const heldByTeam = await batchTeamsPermissions(
      { prisma: this.prisma, session: sessionFor(userId) },
      {
        organizationId,
        teamIds: teamIdsOfUser,
        permissions: defaults.filter(
          (permission) => !isOrgExclusivePermission(permission),
        ),
      },
    );

    const narrowed = intersectAcrossTeams(heldByTeam);
    if (!narrowed) return null;

    return {
      bindings: narrowed.teamIds.map((teamId) => ({
        scopeType: "TEAM" as const,
        scopeId: teamId,
      })),
      permissions: narrowed.permissions,
    };
  }

  /**
   * The teams whose scope this user's key may carry.
   *
   * Team-scoped role bindings carry only a scopeId (no relation to Team by
   * design), so membership is the union of TeamUser rows and TEAM-scoped
   * bindings, resolved against the team table in one pass.
   */
  private async teamsTheUserCanScopeTo({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<string[]> {
    const boundTeamIds = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
      },
      select: { scopeId: true },
    });
    const teams = await this.prisma.team.findMany({
      where: {
        organizationId,
        archivedAt: null,
        OR: [
          { members: { some: { userId } } },
          ...(boundTeamIds.length > 0
            ? [{ id: { in: boundTeamIds.map((binding) => binding.scopeId) } }]
            : []),
        ],
        // Another member's personal workspace is never a scope for this
        // user's key, whatever membership rows exist.
        NOT: { isPersonal: true, ownerUserId: { not: userId } },
      },
      select: { id: true },
    });
    return teams.map((team) => team.id);
  }

  /**
   * Mints the login key at exchange time, replacing any previous CLI login
   * key of the same user + organization + device label first. Returns the
   * plaintext token (shown once, shipped to the CLI) and the scope summary
   * the CLI persists beside it.
   */
  async mintForDeviceSession({
    userId,
    organizationId,
    deviceLabel,
    selection,
  }: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }> {
    // Resolved BEFORE the mint, though it only describes it: these are two
    // more reads, and a read that fails after the key row is live would fail
    // the exchange while leaving that key behind, active and unreachable.
    const scope = await this.resolveScopeSummary({
      organizationId,
      bindings: selection.bindings,
    });

    const created = await this.apiKeyService.create({
      name: `${CLI_LOGIN_KEY_NAME_PREFIX}${deviceLabel}`,
      userId,
      createdByUserId: userId,
      organizationId,
      permissionMode: "restricted",
      permissions: selection.permissions,
      bindings: asCustomBindings(selection.bindings),
      createdByDeviceLabel: deviceLabel,
    });

    // The predecessor stays usable until its replacement exists. A mint has
    // several fallible steps, and the key this call replaces is the one in
    // the user's CLI config right now: revoking it first would leave a
    // failed re-login with no working key at all.
    try {
      await this.revokeLoginKeysForDevice({
        userId,
        organizationId,
        deviceLabel,
        exceptApiKeyId: created.apiKey.id,
        createdBefore: created.apiKey.createdAt,
      });
    } catch (err) {
      // The exchange is about to fail, so the replacement must not survive
      // it: the CLI never receives this token and nothing else can revoke it.
      await this.revokeQuietly({
        apiKeyId: created.apiKey.id,
        userId,
        organizationId,
      });
      throw err;
    }

    return { token: created.token, apiKeyId: created.apiKey.id, scope };
  }

  /**
   * Revokes every non-revoked CLI login key this user holds for this device
   * label in this organization. Used after a re-login mint (which passes its
   * fresh key as `exceptApiKeyId`) and by logout, which passes neither filter
   * and so clears the device outright.
   *
   * `createdBefore` is what keeps two logins racing on the same device from
   * revoking each other: each mint clears only keys OLDER than the one it
   * just created, so the newer key always survives and the CLI is never
   * handed a token that the other exchange revoked a moment later. Two keys
   * created in the same millisecond both survive, which costs a stale key
   * the next login clears rather than a dead credential.
   */
  async revokeLoginKeysForDevice({
    userId,
    organizationId,
    deviceLabel,
    exceptApiKeyId,
    createdBefore,
  }: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Date;
  }): Promise<void> {
    const priorKeys = await this.prisma.apiKey.findMany({
      where: {
        organizationId,
        userId,
        createdByDeviceLabel: deviceLabel,
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
        ...(exceptApiKeyId ? { id: { not: exceptApiKeyId } } : {}),
        ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
      },
      select: { id: true },
    });
    for (const key of priorKeys) {
      await this.revokeQuietly({ apiKeyId: key.id, userId, organizationId });
    }
  }

  /**
   * Revokes one login key by id — the logout path, which stored the minted
   * key's id on the session's Redis token records. Idempotent: a key already
   * revoked (or gone) leaves logout a success, like the token deletes beside
   * it.
   */
  async revokeForLogout({
    apiKeyId,
    userId,
    organizationId,
  }: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    await this.revokeQuietly({ apiKeyId, userId, organizationId });
  }

  private async revokeQuietly({
    apiKeyId,
    userId,
    organizationId,
  }: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.apiKeyService.revoke({
        id: apiKeyId,
        callerUserId: userId,
        callerIsAdmin: false,
        organizationId,
      });
    } catch (err) {
      if (ApiKeyAlreadyRevokedError.is(err) || ApiKeyNotFoundError.is(err)) {
        return;
      }
      throw err;
    }
  }

  /**
   * The reach summary the CLI shows in `whoami` and uses for `--project`
   * resolution. An ORGANIZATION binding means the whole organization;
   * otherwise the project ids the bindings expand to at mint time.
   */
  private async resolveScopeSummary({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: CliKeyBindingSelection[];
  }): Promise<CliKeyScopeSummary> {
    if (bindings.some((binding) => binding.scopeType === "ORGANIZATION")) {
      return { kind: "organization", projectIds: [] };
    }
    const teamIds = bindings
      .filter((binding) => binding.scopeType === "TEAM")
      .map((binding) => binding.scopeId);
    const projectIds = bindings
      .filter((binding) => binding.scopeType === "PROJECT")
      .map((binding) => binding.scopeId);

    const projects = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        team: { organizationId },
        OR: [
          ...(projectIds.length > 0 ? [{ id: { in: projectIds } }] : []),
          ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
        ],
      },
      select: { id: true },
    });
    return {
      kind: "projects",
      projectIds: projects.map((project) => project.id).sort(),
    };
  }
}

/**
 * Narrow the per-team held permissions to the one list a key can carry.
 *
 * One permission list serves every binding, and the mint asserts it at every
 * stamped scope — so the list is the intersection across the teams that grant
 * anything at all, and a team granting nothing (for example a personal team
 * whose owner grant has not projected yet) is dropped instead of zeroing the
 * key. Returns null when nothing mintable remains.
 */
function intersectAcrossTeams(
  heldByTeam: Map<string, string[]>,
): { teamIds: string[]; permissions: string[] } | null {
  const teamIds: string[] = [];
  let kept: string[] | null = null;
  for (const [teamId, held] of heldByTeam) {
    if (held.length === 0) continue;
    teamIds.push(teamId);
    if (kept === null) {
      kept = [...held];
      continue;
    }
    const heldHere = new Set(held);
    kept = kept.filter((permission) => heldHere.has(permission));
  }
  if (!kept || kept.length === 0) return null;
  return { teamIds, permissions: [...kept].sort() };
}

function dedupeBindings(
  bindings: CliKeyBindingSelection[],
): CliKeyBindingSelection[] {
  const seen = new Set<string>();
  const result: CliKeyBindingSelection[] = [];
  for (const binding of bindings) {
    const key = `${binding.scopeType}::${binding.scopeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ scopeType: binding.scopeType, scopeId: binding.scopeId });
  }
  return result;
}

/**
 * Drops permissions no selected binding could ever grant: org-exclusive ones
 * survive only alongside an ORGANIZATION binding (ADR-021).
 */
function filterToGrantable({
  permissions,
  bindings,
}: {
  permissions: string[];
  bindings: CliKeyBindingSelection[];
}): string[] {
  const hasOrgBinding = bindings.some(
    (binding) => binding.scopeType === "ORGANIZATION",
  );
  if (hasOrgBinding) return permissions;
  const filtered = permissions.filter(
    (permission) => !isOrgExclusivePermission(permission as Permission),
  );
  if (filtered.length !== permissions.length) {
    logger.debug(
      { dropped: permissions.length - filtered.length },
      "dropped org-exclusive permissions from a selection with no organization binding",
    );
  }
  return filtered;
}

function asCustomBindings(
  bindings: CliKeyBindingSelection[],
): CustomRoleBindingInput[] {
  return bindings.map((binding) => ({
    role: "CUSTOM" as const,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  }));
}

/**
 * The minimal session shape the batch resolver reads — the same trick
 * `PermissionService` uses; only `user.id` is ever accessed.
 */
function sessionFor(userId: string) {
  return { user: { id: userId } } as Parameters<
    typeof batchTeamsPermissions
  >[0]["session"];
}
