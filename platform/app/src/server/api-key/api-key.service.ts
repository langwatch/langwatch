import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ApiKey, PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import type { Permission } from "~/server/api/rbac";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";
import {
  MalformedCustomRolePermissionsError,
  parseCustomRolePermissions,
  permissionFormatSchema,
} from "~/server/rbac/custom-role-permissions";
import {
  checkRoleBindingPermission,
  resolveApiKeyPermission,
  resolveLegacyCeiling,
} from "~/server/rbac/role-binding-resolver";
import { RoleRepository } from "~/server/role/repositories/role.repository";
import { CUSTOM_ROLE_KIND } from "~/server/role/role-kind";
import { assertPersonalTeamScopesOwnedBy } from "~/server/role-bindings/personal-team-scope";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  ApiKeyRepository,
  type ApiKeyWithBindings,
} from "./api-key.repository";
import {
  generateApiKeyToken,
  hashSecret,
  INGEST_KEY_PREFIX,
  splitApiKeyToken,
  verifySecret,
} from "./api-key-token.utils";
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
} from "./errors";
import { mintLegacyKeyGrant } from "./legacy-grant-mint";
import { HIDDEN_SYSTEM_KEY_NAMES } from "./reserved-names";

const logger = createLogger("langwatch:api-key:service");

/**
 * Keys the product mints and retires on its own — today the ephemeral
 * "Langy session" key, one per chat session with a 6h TTL.
 *
 * They are already absent from every listing (the repository filters
 * HIDDEN_SYSTEM_KEY_NAMES), but absence is not immutability: a caller who
 * learned an id could still rename or revoke one, and revoking it breaks the
 * Langy turn currently authenticating with it. The by-id mutations refuse them
 * for the same reason the listings hide them.
 */
function isSystemManaged(apiKey: { name: string }): boolean {
  return HIDDEN_SYSTEM_KEY_NAMES.includes(apiKey.name);
}

/**
 * Whether a member's own listing already shows them this key: their own keys,
 * plus the organization's service keys.
 *
 * Deliberately in step with `findAllByUser`, which answers the same question
 * for the list. A row a caller can see in the list and not by id is a hole in
 * the CLI's list-then-read loop, not a security boundary. The company-wide
 * ingestion keys are excluded here for the reason they are excluded there:
 * their source, template and activity metadata is admin territory.
 *
 * A service credential (no user) is not a member and gets nothing from this:
 * its listing is the org-wide one, which takes organization:manage.
 *
 * Revocation is not part of the question. The listing hides revoked keys so a
 * member's list is not a graveyard; reading one back by an id already held is
 * how you find out the key you are holding was revoked.
 */
function isListedForMember(
  apiKey: { userId: string | null; ingestSourceType: string | null },
  callerUserId: string | null,
): boolean {
  if (!callerUserId) return false;
  if (apiKey.userId === callerUserId) return true;
  return apiKey.userId === null && apiKey.ingestSourceType === null;
}

type RoleBindingBase = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

type RoleBindingInput =
  | (RoleBindingBase & { role: "ADMIN" | "MEMBER" | "VIEWER" })
  | (RoleBindingBase & { role: "CUSTOM"; customRoleId?: string });

type CreatorScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

/**
 * A key with its bindings and the explicit permission set a `restricted` key
 * carries on its private custom role, flattened onto the record so a reader
 * does not have to know that indirection exists.
 */
export type ApiKeyDetail = ApiKeyWithBindings & { permissions: string[] };

/**
 * Who a credential change is attributed to in the grants ledger. A key minted
 * or retired by the product itself acts as nobody, so the service is named as
 * the system principal rather than inventing a user.
 */
const ledgerActorFor = (userId: string | null | undefined): LedgerActor =>
  userId
    ? { type: "user", id: userId }
    : { type: "system", id: "system:api-key-service" };

export class ApiKeyService {
  private readonly repo: ApiKeyRepository;
  private readonly roleRepo: RoleRepository;
  private readonly prisma: PrismaClient;
  private readonly mintLegacyGrant: (args: {
    apiKey: ApiKeyWithBindings;
  }) => void;

  constructor({
    prisma,
    repo,
    roleRepo,
    mintLegacyGrant = mintLegacyKeyGrant,
  }: {
    prisma: PrismaClient;
    repo: ApiKeyRepository;
    roleRepo: RoleRepository;
    /**
     * The read-through mint a verified legacy key triggers (decision 1).
     * Injectable so a test can watch the seam without an event-sourcing
     * stack behind it.
     */
    mintLegacyGrant?: (args: { apiKey: ApiKeyWithBindings }) => void;
  }) {
    this.prisma = prisma;
    this.repo = repo;
    this.roleRepo = roleRepo;
    this.mintLegacyGrant = mintLegacyGrant;
  }

  static create(prisma: PrismaClient): ApiKeyService {
    return new ApiKeyService({
      prisma,
      repo: ApiKeyRepository.create(prisma),
      roleRepo: new RoleRepository(prisma),
    });
  }

  /**
   * Creates a new API key with the given role bindings inside a transaction.
   * Returns the plaintext token (shown once) plus the persisted record.
   *
   * Enforces two invariants before persisting:
   *   1. The target user is a member of the target organization.
   *   2. Every requested binding is within the target user's own ceiling — a
   *      key cannot grant permissions the user does not themselves hold at the
   *      requested scope. Violations throw `ApiKeyScopeViolationError`.
   *
   * When `assignedToUserId` is provided, the key is owned by that user
   * (their permissions act as the ceiling). The caller must be an org admin.
   */
  async create({
    name,
    description,
    userId,
    createdByUserId,
    organizationId,
    expiresAt,
    permissionMode,
    permissions,
    bindings,
    ingestSourceType,
    ingestionTemplateId,
    createdByDeviceLabel,
    isSystemManaged = false,
  }: {
    name: string;
    description?: string | null;
    userId?: string | null;
    createdByUserId?: string | null;
    organizationId: string;
    expiresAt?: Date | null;
    permissionMode: string;
    permissions?: string[];
    bindings: RoleBindingInput[];
    ingestSourceType?: string | null;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
    /**
     * Only the product's own minting paths (e.g. the Langy session key) may
     * claim a HIDDEN_SYSTEM_KEY_NAMES name. Customer entry points leave this
     * unset: a customer-created key with a reserved name would vanish from
     * every listing and the system-managed guard would refuse to ever rename
     * or revoke it — a stealth, permanent credential.
     */
    isSystemManaged?: boolean;
  }): Promise<{ token: string; apiKey: ApiKey }> {
    if (!isSystemManaged && HIDDEN_SYSTEM_KEY_NAMES.includes(name)) {
      throw new ApiKeyReservedNameError(name);
    }

    const hasCustomBinding = bindings.some(
      (b) => b.role === TeamUserRole.CUSTOM,
    );
    const hasPermissions = !!permissions && permissions.length > 0;
    const isRestricted = permissionMode === "restricted";

    if (isRestricted || hasCustomBinding || hasPermissions) {
      if (!isRestricted) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM permissions require permissionMode 'restricted'",
        );
      }
      if (!hasCustomBinding) {
        throw new ApiKeyScopeViolationError(
          "restricted mode requires at least one CUSTOM binding",
        );
      }
      if (!hasPermissions) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM bindings require at least one permission",
        );
      }
    }

    if (hasPermissions) {
      ApiKeyService.assertPermissionFormat(permissions);
    }

    const sortedPermissions = hasPermissions
      ? [...permissions].sort()
      : undefined;

    if (userId) {
      await this.ensureCallerIsOrgMember({ userId, organizationId });
    } else if (bindings.length > 0) {
      for (const binding of bindings) {
        await this.resolveAndValidateScope({ binding, organizationId });
      }
    }

    // Intentional: service keys (userId=null) with no explicit bindings
    // default to org-wide ADMIN. This is the expected behavior for
    // headless automation keys that need full org access.
    let effectiveBindings = bindings;
    if (!userId && effectiveBindings.length === 0) {
      effectiveBindings = [
        {
          role: "ADMIN",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      ];
    }

    // A personal key has no such default, and zero bindings means zero access:
    // `resolveApiKeyPermission` asks the key's own bindings first and denies
    // when there are none. Minting it would hand somebody a token that is
    // authorized for nothing anywhere, with nothing along the way saying so.
    // The REST schema refuses this with a field path; this is the backstop for
    // every other caller.
    if (userId && effectiveBindings.length === 0) {
      throw new ApiKeyScopeViolationError(
        "A personal API key needs at least one role binding",
      );
    }

    // Ingestion-only keys (identified by ingestSourceType) carry the ik-lw-
    // prefix so they're distinguishable from full-access sk-lw- keys; same
    // scheme otherwise, so resolution is unaffected.
    const { token, lookupId, hashedSecret } = generateApiKeyToken(
      ingestSourceType ? { prefix: INGEST_KEY_PREFIX } : undefined,
    );

    // Everything the request can be refused over is decided before anything
    // is written: the key's own row is a plain insert, and its private role
    // and grants are ledger commands, so there is no transaction left to roll
    // a late refusal back with.
    if (userId) {
      await this.assertBindingsWithinCeiling({
        prisma: this.prisma,
        ceilingUserId: userId,
        organizationId,
        bindings,
        rawPermissions: sortedPermissions,
      });
    }
    if (effectiveBindings.length > 0) {
      // A key may reach a personal workspace only as its owner's own
      // credential, whose ceiling already caps it. A service key or a key
      // owned by anyone else binding in would hand the private workspace to
      // a second principal.
      await assertPersonalTeamScopesOwnedBy({
        client: this.prisma,
        scopes: effectiveBindings,
        ownerUserId: userId ?? null,
      });
    }

    const actor = ledgerActorFor(createdByUserId ?? userId);
    const apiKey = await this.repo.create({
      name,
      description,
      lookupId,
      hashedSecret,
      permissionMode,
      userId,
      createdByUserId,
      organizationId,
      expiresAt,
      ingestSourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
    });

    if (sortedPermissions) {
      const customRole = await this.roleRepo.create(
        {
          name: `apikey:${apiKey.id}`,
          organizationId,
          permissions: sortedPermissions,
          kind: CUSTOM_ROLE_KIND.SYSTEM_API_KEY,
        },
        { actor },
      );
      effectiveBindings = effectiveBindings.map((b) =>
        b.role === TeamUserRole.CUSTOM
          ? { ...b, customRoleId: customRole.id }
          : b,
      );
    }

    if (effectiveBindings.length > 0) {
      await this.repo.createRoleBindings({
        apiKeyId: apiKey.id,
        organizationId,
        bindings: effectiveBindings,
        actor,
      });
    }

    return { token, apiKey };
  }

  /**
   * Updates an API key's metadata and/or role bindings.
   * The token itself is NOT changed — only name, description, permissionMode,
   * and bindings can be updated.
   *
   * For non-admins: only the key owner can update.
   * For admins: can update any key in the organization.
   *
   * Binding changes are validated against the key owner's ceiling.
   */
  async update({
    id,
    callerUserId,
    callerIsAdmin,
    organizationId,
    name,
    description,
    permissionMode,
    permissions,
    bindings,
  }: {
    id: string;
    /**
     * Null when the caller is a service credential. Ownership then never
     * matches, so a null caller updates a key only through `callerIsAdmin`.
     */
    callerUserId: string | null;
    callerIsAdmin: boolean;
    organizationId: string;
    name?: string;
    description?: string | null;
    permissionMode?: string;
    permissions?: string[];
    bindings?: RoleBindingInput[];
  }): Promise<ApiKeyWithBindings> {
    const existing = await this.repo.findById({ id });
    if (!existing) throw new ApiKeyNotFoundError(id);
    if (existing.organizationId !== organizationId) {
      throw new ApiKeyNotFoundError(id);
    }
    // Reported as not-found, like the tenancy mismatch above, so the response
    // doesn't confirm the id exists.
    if (isSystemManaged(existing)) throw new ApiKeyNotFoundError(id);
    // Renaming a customer key TO a reserved name is the same squat as
    // creating one: the key would drop out of every listing and this very
    // guard would then refuse to rename or revoke it.
    if (name !== undefined && HIDDEN_SYSTEM_KEY_NAMES.includes(name)) {
      throw new ApiKeyReservedNameError(name);
    }

    if (!callerIsAdmin) {
      if (!existing.userId || existing.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }

    if (existing.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    const updateHasCustomBinding =
      bindings?.some((b) => b.role === TeamUserRole.CUSTOM) ?? false;
    const updateHasPermissions = !!permissions && permissions.length > 0;
    const updateIsRestricted = permissionMode === "restricted";

    if (updateIsRestricted || updateHasCustomBinding || updateHasPermissions) {
      if (!updateIsRestricted) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM permissions require permissionMode 'restricted'",
        );
      }
      if (!updateHasCustomBinding) {
        throw new ApiKeyScopeViolationError(
          "restricted mode requires bindings with at least one CUSTOM role",
        );
      }
      if (!updateHasPermissions) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM bindings require at least one permission",
        );
      }
    }

    if (updateHasPermissions) {
      ApiKeyService.assertPermissionFormat(permissions);
    }

    const sortedPermissions = updateHasPermissions
      ? [...permissions].sort()
      : undefined;

    if (bindings && !existing.userId) {
      for (const binding of bindings) {
        await this.resolveAndValidateScope({ binding, organizationId });
      }
    }

    const oldCustomRoleIds = [
      ...new Set(
        existing.roleBindings
          .map((rb) => rb.customRoleId)
          .filter((cid): cid is string => cid !== null),
      ),
    ];

    const actor = ledgerActorFor(callerUserId);

    if (bindings && existing.userId) {
      await this.assertBindingsWithinCeiling({
        prisma: this.prisma,
        ceilingUserId: existing.userId,
        organizationId,
        bindings,
        rawPermissions: sortedPermissions,
      });
    }
    if (bindings) {
      // Same personal-workspace line as create(): replacement bindings may
      // reach a personal workspace only when this key acts as its owner.
      await assertPersonalTeamScopesOwnedBy({
        client: this.prisma,
        scopes: bindings,
        ownerUserId: existing.userId,
      });
    }

    let effectiveBindings = bindings;

    if (sortedPermissions && effectiveBindings) {
      const existingCustomRoleId = existing.roleBindings.find(
        (rb) => rb.customRoleId !== null,
      )?.customRoleId;

      const canReuse = existingCustomRoleId
        ? await this.roleRepo.isExclusiveToApiKey({
            roleId: existingCustomRoleId,
            apiKeyId: id,
          })
        : false;

      let customRole;
      if (canReuse && existingCustomRoleId) {
        customRole = await this.roleRepo.update(
          existingCustomRoleId,
          { permissions: sortedPermissions },
          { actor },
        );
      } else {
        customRole = await this.roleRepo.create(
          {
            name: `apikey:${id}:${generate(KSUID_RESOURCES.API_KEY_ROLE).toString()}`,
            organizationId,
            permissions: sortedPermissions,
            kind: CUSTOM_ROLE_KIND.SYSTEM_API_KEY,
          },
          { actor },
        );
      }
      effectiveBindings = effectiveBindings.map((b) =>
        b.role === TeamUserRole.CUSTOM
          ? { ...b, customRoleId: customRole.id }
          : b,
      );
    }

    await this.repo.update({
      id,
      name,
      description,
      permissionMode,
    });

    if (effectiveBindings) {
      await this.repo.replaceRoleBindings({
        apiKeyId: id,
        organizationId,
        bindings: effectiveBindings,
        actor,
      });

      const newCustomRoleIds = new Set(
        effectiveBindings
          .filter(
            (b): b is Extract<RoleBindingInput, { role: "CUSTOM" }> =>
              b.role === "CUSTOM",
          )
          .map((b) => b.customRoleId)
          .filter((cid): cid is string => !!cid),
      );
      const orphanedRoleIds = oldCustomRoleIds.filter(
        (roleId) => !newCustomRoleIds.has(roleId),
      );
      if (orphanedRoleIds.length > 0) {
        await this.roleRepo.deleteExclusiveToApiKey({
          roleIds: orphanedRoleIds,
          apiKeyId: id,
          organizationId,
          actor,
        });
      }
    }

    const updated = await this.repo.findById({ id });
    if (!updated) throw new ApiKeyNotFoundError(id);
    return updated;
  }

  /**
   * Verifies the creator is a member of the org before an API key can be minted.
   */
  async ensureCallerIsOrgMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const orgUser = await this.repo.findOrgMembership({
      userId,
      organizationId,
    });
    if (!orgUser) {
      throw new ApiKeyScopeViolationError("Not a member of this organization", {
        meta: { userId, organizationId },
      });
    }
  }

  /**
   * Validates every requested binding against the ceiling user's permissions.
   * Must be called inside a transaction to prevent TOCTOU races where
   * the user's bindings change between validation and write.
   */
  private async assertBindingsWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    bindings,
    rawPermissions,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    bindings: RoleBindingInput[];
    rawPermissions?: string[];
  }): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.resolveAndValidateScope({
        binding,
        organizationId,
      });

      if (binding.role === TeamUserRole.CUSTOM) {
        if (rawPermissions) {
          await this.assertRawPermissionsWithinCeiling({
            prisma,
            ceilingUserId,
            organizationId,
            scope,
            permissions: rawPermissions,
          });
        } else if (binding.customRoleId) {
          await this.assertCustomRoleWithinCeiling({
            prisma,
            ceilingUserId,
            organizationId,
            scope,
            customRoleId: binding.customRoleId,
          });
        } else {
          throw new ApiKeyScopeViolationError(
            "CUSTOM role requires a customRoleId",
          );
        }
      } else {
        await this.assertBuiltinRoleWithinCeiling({
          prisma,
          ceilingUserId,
          organizationId,
          scope,
          role: binding.role,
        });
      }
    }
  }

  private async resolveAndValidateScope({
    binding,
    organizationId,
  }: {
    binding: RoleBindingInput;
    organizationId: string;
  }): Promise<CreatorScope> {
    if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
      if (binding.scopeId !== organizationId) {
        throw new ApiKeyScopeViolationError(
          "Organization scope must match the API key's organization",
          { meta: { scopeId: binding.scopeId, organizationId } },
        );
      }
      return { type: "org", id: binding.scopeId };
    }

    if (binding.scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.repo.findTeamInOrg({
        teamId: binding.scopeId,
        organizationId,
      });
      if (!team) {
        throw new ApiKeyScopeViolationError(
          `Team ${binding.scopeId} not found in this organization`,
          { meta: { teamId: binding.scopeId, organizationId } },
        );
      }
      return { type: "team", id: binding.scopeId };
    }

    const project = await this.repo.findProjectWithTeam({
      projectId: binding.scopeId,
    });
    if (!project) {
      throw new ApiKeyScopeViolationError(
        `Project ${binding.scopeId} not found or archived`,
        { meta: { projectId: binding.scopeId } },
      );
    }
    if (project.team.organizationId !== organizationId) {
      throw new ApiKeyScopeViolationError(
        `Project ${binding.scopeId} does not belong to this organization`,
        { meta: { projectId: binding.scopeId, organizationId } },
      );
    }
    return { type: "project", id: binding.scopeId, teamId: project.team.id };
  }

  private async assertCustomRoleWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    customRoleId,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    customRoleId: string;
  }): Promise<void> {
    const customRole = await this.roleRepo.findByIdInOrg(
      customRoleId,
      organizationId,
    );
    if (!customRole) {
      throw new ApiKeyScopeViolationError(
        `Custom role ${customRoleId} not found`,
        { meta: { customRoleId, organizationId } },
      );
    }
    let perms: string[];
    try {
      perms = parseCustomRolePermissions({
        customRoleId,
        permissions: customRole.permissions,
      });
    } catch (err) {
      if (err instanceof MalformedCustomRolePermissionsError) {
        throw new ApiKeyScopeViolationError(
          `Custom role ${customRoleId} has malformed permissions`,
          {
            meta: { customRoleId, organizationId },
            reasons: [err],
          },
        );
      }
      throw err;
    }
    // Same legacy fallback as the raw-permission and builtin-role branches.
    // This one used to call `checkRoleBindingPermission` bare, so a user whose
    // access comes from legacy membership was refused here even though the
    // branch beside it would have allowed the identical permission.
    const legacy = await resolveLegacyCeiling({
      prisma,
      userId: ceilingUserId,
      organizationId,
      scope,
    });

    for (const perm of perms) {
      const userHas =
        (await checkRoleBindingPermission({
          prisma,
          principal: { type: "user", id: ceilingUserId },
          organizationId,
          scope,
          permission: perm as Permission,
          // One ADR-092 shadow comparison per permission would fan a single
          // mint out into dozens of detached collects. The mint path's engine
          // coverage comes from enforceApiKeyCeiling instead, which shadows
          // the same question on every request the key goes on to make.
          skipShadow: true,
        })) || legacy.grants(perm as Permission);
      if (!userHas) {
        throw new ApiKeyScopeViolationError(
          `Cannot grant permission "${perm}" — exceeds your own access`,
          { meta: { permission: perm, scope } },
        );
      }
    }
  }

  private async assertRawPermissionsWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    permissions,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    permissions: string[];
  }): Promise<void> {
    // Resolved once for the whole request, not per permission. The mint path
    // that calls this (Langy's per-turn session key) passes ~23 permissions
    // inside a 5-second interactive transaction, and langyApiKey.ts records
    // what per-permission queries did to it once already: the fan-out starved
    // the connection pool and aborted the transaction. Two queries, flat.
    const legacy = await resolveLegacyCeiling({
      prisma,
      userId: ceilingUserId,
      organizationId,
      scope,
    });

    for (const perm of permissions) {
      const userHas =
        (await checkRoleBindingPermission({
          prisma,
          principal: { type: "user", id: ceilingUserId },
          organizationId,
          scope,
          permission: perm as Permission,
          // Same reason as the custom-role loop above: the mint path's engine
          // coverage comes from the per-request enforceApiKeyCeiling path,
          // not from one shadow per candidate permission.
          skipShadow: true,
        })) || legacy.grants(perm as Permission);

      if (!userHas) {
        throw new ApiKeyScopeViolationError(
          `Cannot grant permission "${perm}" — exceeds your own access`,
          { meta: { permission: perm, scope } },
        );
      }
    }
  }

  private async assertBuiltinRoleWithinCeiling({
    prisma,
    ceilingUserId,
    organizationId,
    scope,
    role,
  }: {
    prisma: PrismaClient;
    ceilingUserId: string;
    organizationId: string;
    scope: CreatorScope;
    role: "ADMIN" | "MEMBER" | "VIEWER";
  }): Promise<void> {
    const isOrgScope = scope.type === "org";
    const representativePermission: Permission =
      role === TeamUserRole.ADMIN
        ? isOrgScope
          ? "organization:manage"
          : "project:manage"
        : role === TeamUserRole.MEMBER
          ? isOrgScope
            ? "organization:view"
            : "project:update"
          : "project:view";

    const userHasPermission =
      (await checkRoleBindingPermission({
        prisma,
        principal: { type: "user", id: ceilingUserId },
        organizationId,
        scope,
        permission: representativePermission,
      })) ||
      // The builtin-role UI is the ordinary way a person creates a key, so
      // leaving this branch bare meant the common path still refused a
      // legacy-membership user while the Langy path had been fixed.
      (
        await resolveLegacyCeiling({
          prisma,
          userId: ceilingUserId,
          organizationId,
          scope,
        })
      ).grants(representativePermission);

    if (!userHasPermission) {
      throw new ApiKeyScopeViolationError(
        `Cannot create API key with ${role} permissions — exceeds your own access at ${scope.type}:${scope.id}`,
        { meta: { role, scope } },
      );
    }
  }

  private static assertPermissionFormat(permissions: string[]): void {
    for (const perm of permissions) {
      if (!permissionFormatSchema.safeParse(perm).success) {
        throw new ApiKeyScopeViolationError(
          `Invalid permission format "${perm}" — must match resource:action (lowercase)`,
          { meta: { permission: perm } },
        );
      }
    }
  }

  /**
   * Verifies an API key token string and returns the key record if valid.
   * Returns null if the token is invalid, revoked, or not found.
   *
   * Does NOT update lastUsedAt — callers should call markUsed() after
   * confirming the request is fully authorized (e.g., project resolved).
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<ApiKeyWithBindings | null> {
    const parts = splitApiKeyToken(token);
    if (!parts) return null;

    const apiKey = await this.repo.findByLookupId({ lookupId: parts.lookupId });
    if (!apiKey) return null;

    // Revoked tokens are rejected
    if (apiKey.revokedAt) return null;

    // Expired tokens are rejected
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    // Verify the secret portion — supports both current HMAC and legacy SHA-256
    const result = verifySecret(parts.secret, apiKey.hashedSecret);
    if (result === "no_match") return null;

    // Auto-upgrade legacy SHA-256 hashes to HMAC-SHA256 (fire-and-forget)
    if (result === "match_legacy") {
      const upgraded = hashSecret(parts.secret);
      this.repo
        .upgradeHash({ id: apiKey.id, hashedSecret: upgraded })
        .catch((err: unknown) => {
          logger.warn(
            { err, apiKeyId: apiKey.id },
            "failed to upgrade legacy hash to HMAC (fire-and-forget)",
          );
        });
    }

    // A key whose access predates the grants ledger writes that access down
    // the first time it is used (ADR-092 decision 1 — no key sunset, ever).
    // Fire-and-forget for the same reason the hash upgrade above is: the
    // answer to "is this credential real" cannot wait on, or be failed by, a
    // write nobody asked for.
    this.mintLegacyGrant({ apiKey });

    return apiKey;
  }

  /**
   * Fire-and-forget lastUsedAt update. Call after full authorization succeeds.
   */
  markUsed({ id }: { id: string }): void {
    this.repo.updateLastUsedAt({ id }).catch((err: unknown) => {
      logger.warn(
        { err, apiKeyId: id },
        "failed to update API key lastUsedAt (fire-and-forget)",
      );
    });
  }

  /**
   * Lists all API keys for a user within an organization.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.repo.findAllByUser({ userId, organizationId });
  }

  /**
   * Lists ALL API keys in an organization (admin only).
   */
  async listAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.repo.findAllByOrganization({ organizationId });
  }

  /**
   * Revokes an API key by setting revokedAt. Never hard-deletes.
   * Admins can revoke any key in the org. Non-admins can only revoke their own.
   */
  async revoke({
    id,
    callerUserId,
    callerIsAdmin,
    organizationId,
  }: {
    id: string;
    /**
     * Null when the caller is a service credential. Ownership then never
     * matches, so a null caller revokes a key only through `callerIsAdmin`.
     */
    callerUserId: string | null;
    callerIsAdmin: boolean;
    organizationId: string;
  }): Promise<ApiKey> {
    const apiKey = await this.repo.findById({ id });
    if (!apiKey) throw new ApiKeyNotFoundError(id);
    if (apiKey.organizationId !== organizationId) {
      throw new ApiKeyNotFoundError(id);
    }
    if (isSystemManaged(apiKey)) throw new ApiKeyNotFoundError(id);
    if (!callerIsAdmin) {
      if (!apiKey.userId || apiKey.userId !== callerUserId) {
        throw new ApiKeyNotOwnedError(id);
      }
    }
    if (apiKey.revokedAt) throw new ApiKeyAlreadyRevokedError(id);

    const fresh = await this.repo.findById({ id });
    const customRoleIds = [
      ...new Set(
        (fresh?.roleBindings ?? [])
          .map((rb) => rb.customRoleId)
          .filter((cid): cid is string => cid !== null),
      ),
    ];

    const result = await this.repo.revoke({ id });

    if (customRoleIds.length > 0) {
      await this.roleRepo.deleteExclusiveToApiKey({
        roleIds: customRoleIds,
        apiKeyId: id,
        organizationId,
        actor: ledgerActorFor(callerUserId),
      });
    }

    return result;
  }

  /**
   * Checks whether a user has an ADMIN role binding at the organization scope.
   */
  async isOrgAdmin({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const binding = await this.repo.findOrgAdminBinding({
      userId,
      organizationId,
    });
    return !!binding;
  }

  /**
   * The service-credential counterpart of {@link isOrgAdmin}: whether the API
   * key itself holds an ADMIN role binding at the organization scope. A
   * credential can carry `organization:manage` through a custom role without
   * being an organization admin, and admin-only decisions (minting unbound
   * service keys, revoking someone else's key) must not accept that as
   * adminness.
   */
  async isOrgAdminApiKey({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<boolean> {
    const binding = await this.repo.findOrgAdminApiKeyBinding({
      apiKeyId,
      organizationId,
    });
    return !!binding;
  }

  /**
   * Whether the presented credential resolves the given permission at
   * organization scope: the same primitive the route-level
   * `requireOrgPermission` middleware applies, exposed for handlers that need
   * a second, stricter permission on one branch of a route.
   */
  async hasOrgScopedPermission({
    apiKeyId,
    userId,
    organizationId,
    permission,
  }: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: Permission;
  }): Promise<boolean> {
    return resolveApiKeyPermission({
      prisma: this.prisma,
      apiKeyId,
      userId,
      organizationId,
      scope: { type: "org", id: organizationId },
      permission,
    });
  }

  /**
   * Gets a single API key by ID (for display, not verification).
   */
  async getById({ id }: { id: string }): Promise<ApiKeyWithBindings | null> {
    return this.repo.findById({ id });
  }

  /**
   * One key the caller already holds an id for, with its bindings and the
   * explicit permission set behind a `restricted` mode.
   *
   * Every refusal is reported as not-found: an id from another organization,
   * a key the product manages itself, and a key belonging to someone else all
   * answer identically to an id that never existed. A 403 on the last of those
   * would confirm the id names a real key, which is exactly what a caller
   * probing for other people's keys is after.
   *
   * `callerCanReadAnyKey` is the org-administration branch: it lifts the
   * ownership requirement, and nothing else.
   */
  async getByIdForCaller({
    id,
    organizationId,
    callerUserId,
    callerCanReadAnyKey,
  }: {
    id: string;
    organizationId: string;
    callerUserId: string | null;
    callerCanReadAnyKey: boolean;
  }): Promise<ApiKeyDetail> {
    const apiKey = await this.repo.findByIdInOrg({ id, organizationId });
    if (!apiKey) throw new ApiKeyNotFoundError(id);
    if (isSystemManaged(apiKey)) throw new ApiKeyNotFoundError(id);
    if (!callerCanReadAnyKey && !isListedForMember(apiKey, callerUserId)) {
      throw new ApiKeyNotFoundError(id);
    }

    return {
      ...apiKey,
      permissions: await this.resolveKeyPermissions({ apiKey, organizationId }),
    };
  }

  /**
   * The permissions a key's CUSTOM bindings confer, deduplicated and sorted.
   *
   * A malformed role is skipped rather than thrown: this is a read, and one
   * corrupted row must not make the key unreadable. The ceiling paths, where
   * the same data drives a grant, keep failing closed instead.
   */
  private async resolveKeyPermissions({
    apiKey,
    organizationId,
  }: {
    apiKey: ApiKeyWithBindings;
    organizationId: string;
  }): Promise<string[]> {
    const customRoleIds = [
      ...new Set(
        apiKey.roleBindings
          .map((rb) => rb.customRoleId)
          .filter((cid): cid is string => cid !== null),
      ),
    ];

    const roles = await this.repo.findCustomRolePermissionsInOrg({
      ids: customRoleIds,
      organizationId,
    });

    const permissions = new Set<string>();
    for (const role of roles) {
      try {
        for (const permission of parseCustomRolePermissions({
          customRoleId: role.id,
          permissions: role.permissions,
        })) {
          permissions.add(permission);
        }
      } catch (err) {
        if (!(err instanceof MalformedCustomRolePermissionsError)) throw err;
        // Both ids are opaque row identifiers, deliberately logged: naming the
        // role and the key whose permission set lost it is the only way an
        // operator can find the corrupted row. No secret, token or address is
        // derivable from either, and the key's own secret never reaches here.
        logger.warn(
          { err, customRoleId: role.id, apiKeyId: apiKey.id },
          "custom role has malformed permissions; omitted from the key's permission set",
        );
      }
    }

    return [...permissions].sort();
  }

  /**
   * Resolve one key id to its display name, within an organization. Returns
   * null for an id that belongs to another organization or does not exist, so
   * the two are indistinguishable to the caller.
   *
   * A revoked key still resolves: the trace it authorized is still readable,
   * and naming the key that produced it is the whole point.
   */
  async getNameByIdInOrg({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<{ name: string; revoked: boolean } | null> {
    const row = await this.repo.findNameByIdInOrg({ id, organizationId });
    if (!row) return null;
    return { name: row.name, revoked: row.revokedAt !== null };
  }

  async getUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }) {
    return this.repo.findUserBindings({ userId, organizationId });
  }

  async getOrgProjects({ organizationId }: { organizationId: string }) {
    return this.repo.findProjectsInOrg({ organizationId });
  }

  async getOrgTeams({ organizationId }: { organizationId: string }) {
    return this.repo.findTeamsInOrg({ organizationId });
  }

  async getOrgMembers({ organizationId }: { organizationId: string }) {
    return this.repo.findOrgMembers({ organizationId });
  }

  async enrichBindingsWithNames({
    bindings,
  }: {
    bindings: Array<{
      id: string;
      role: string;
      customRoleId: string | null;
      scopeType: string;
      scopeId: string;
    }>;
  }) {
    const orgIds = new Set<string>();
    const teamIds = new Set<string>();
    const projectIds = new Set<string>();
    const customRoleIds = new Set<string>();
    for (const b of bindings) {
      if (b.scopeType === "ORGANIZATION") orgIds.add(b.scopeId);
      else if (b.scopeType === "TEAM") teamIds.add(b.scopeId);
      else if (b.scopeType === "PROJECT") projectIds.add(b.scopeId);
      if (b.customRoleId) customRoleIds.add(b.customRoleId);
    }

    const [orgs, teams, projects, customRoles] = await Promise.all([
      this.repo.findOrgsByIds([...orgIds]),
      this.repo.findTeamsByIds([...teamIds]),
      this.repo.findProjectsByIds([...projectIds]),
      this.repo.findCustomRolesByIds([...customRoleIds]),
    ]);

    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const activeProjectIds = new Set(projects.map((p) => p.id));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const customRoleName = new Map(customRoles.map((r) => [r.id, r.name]));

    return {
      orgName,
      teamName,
      activeProjectIds,
      projectName,
      customRoleName,
      customRoles,
    };
  }

  async enrichApiKeyList({ apiKeys }: { apiKeys: ApiKeyWithBindings[] }) {
    const customRoleIds = new Set<string>();
    const userIds = new Set<string>();
    for (const k of apiKeys) {
      for (const rb of k.roleBindings) {
        if (rb.customRoleId) customRoleIds.add(rb.customRoleId);
      }
      if (k.userId) userIds.add(k.userId);
      if (k.createdByUserId) userIds.add(k.createdByUserId);
    }

    const [customRoles, users] = await Promise.all([
      this.repo.findCustomRolesByIds([...customRoleIds]),
      this.repo.findUsersByIds([...userIds]),
    ]);

    return {
      customRoles,
      users,
    };
  }
}
