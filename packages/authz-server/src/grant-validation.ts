/**
 * ADR-092 §11 — everything GrantsService refuses to write, and why. Split
 * out of the service so grants.service.ts reads as the four verbs plus
 * offboarding: the rules a write must satisfy (tenancy of the scope,
 * tenancy AND vocabulary of a custom role, existence of the row a write
 * targets) and the naming of the two knowable storage failures all live
 * here.
 *
 * These are module functions over the repository, not methods: they hold no
 * state and every one of them is a pure question asked of storage.
 */
import { type AuthzScopeRef, isRegistryPermission } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import {
  type AuthzGrantsRepository,
  type BindingPrincipalWhere,
  BindingMissingError,
  DuplicateBindingError,
} from "./authz-grants.repository";
import type { GrantPrincipal, GrantRole } from "./grants.service";

export class GrantValidationError extends HandledError {
  constructor(message: string, meta: Record<string, unknown> = {}) {
    super("grant_validation_failed", message, { httpStatus: 400, meta });
    this.name = "GrantValidationError";
  }
}

/** Every scope a role binding can name - the resource tier cannot. */
export type GrantableScope = Exclude<AuthzScopeRef, { type: "resource" }>;

export const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

// Stage C5 replaces this rejection with real ResourceGrant storage; until
// then a resource scope has no row to write, so the write surface says so.
export const RESOURCE_SCOPE_REJECTION =
  "Resource-tier access is granted by sharing the resource, not by a role binding";

/** The one not-found shape, used for a missing binding AND for one owned by
 *  another organization: confirming that a foreign binding exists is itself
 *  a leak, so both answers are identical. `meta` carries whatever the caller
 *  actually named - a binding id when it had one, the scope it was writing at
 *  otherwise - because a fabricated id is worse than a missing field. */
export function bindingNotFound(
  meta: Record<string, unknown>,
): GrantValidationError {
  return new GrantValidationError("Role binding not found", meta);
}

/**
 * Name the two write failures the caller can act on and let everything else
 * through as-is (it degrades to "unknown" at the boundary, with the trace
 * id, which is the right answer for an infra fault).
 *
 * Duplicate: the partial unique indexes key on the role too, so it only
 * fires when the principal already holds this SAME role at the scope.
 * Missing: the row went away between the pre-read and the write, which the
 * caller should see as the same not-found the pre-read produces.
 */
export function rethrowKnownWriteFailure(
  error: unknown,
  { bindingId, ...meta }: { bindingId?: string } & Record<string, unknown>,
): never {
  if (error instanceof DuplicateBindingError) {
    throw new GrantValidationError(
      "This principal already holds this role at this scope - update or revoke the existing binding",
      { ...meta, ...(bindingId ? { bindingId } : {}) },
    );
  }
  if (error instanceof BindingMissingError) {
    throw bindingNotFound({ ...meta, ...(bindingId ? { bindingId } : {}) });
  }
  throw error;
}

/** A binding exists AND belongs to the organization the caller named. */
export async function assertBindingInOrganization({
  repository,
  bindingId,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  bindingId: string;
  organizationId: string;
}): Promise<void> {
  const binding = await repository.findBinding({ bindingId });
  if (!binding || binding.organizationId !== organizationId) {
    throw bindingNotFound({ bindingId });
  }
}

export async function assertScopeBelongsToOrganization({
  repository,
  where,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  where: GrantableScope;
  organizationId: string;
}): Promise<void> {
  if (where.type === "organization") return;
  if (where.type === "team") {
    const team = await repository.findTeamOrganization({ teamId: where.id });
    if (team?.organizationId !== organizationId) {
      throw new GrantValidationError("Team is not in this organization", {
        teamId: where.id,
      });
    }
    return;
  }
  const lineage = await repository.findProjectLineage({ projectId: where.id });
  if (
    lineage?.organizationId !== organizationId ||
    lineage.teamId !== where.teamId
  ) {
    throw new GrantValidationError("Project is not in this scope", {
      projectId: where.id,
    });
  }
}

/**
 * Built-in role keys are already a closed union in the type system, so only
 * CUSTOM roles need checking - and they need two things: the role belongs to
 * this organization, and every permission it lists is in the registry. A
 * role carrying a string the registry never heard of grants nothing at
 * decide time, so binding to it silently produces a grant that does not
 * work; rejecting on the write is where the admin can still act on it.
 */
export async function assertRoleUsable({
  repository,
  role,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  role: GrantRole;
  organizationId: string;
}): Promise<void> {
  if (!("customRoleId" in role)) return;
  const { customRoleId } = role;
  const customRole = await repository.findCustomRole({ customRoleId });
  if (!customRole || customRole.organizationId !== organizationId) {
    throw new GrantValidationError(
      "Custom role does not belong to this organization",
      { customRoleId },
    );
  }
  const unknown = unknownPermissions(customRole.permissions);
  if (unknown.length > 0) {
    throw new GrantValidationError(
      "Custom role lists permissions that do not exist",
      { customRoleId, unknownPermissions: unknown },
    );
  }
}

/**
 * The entries of a stored custom-role payload the registry does not
 * recognise. A payload that is not an array carries no permissions at all
 * (the collector's lenient parse reads it as an empty list), so there is
 * nothing to reject.
 */
function unknownPermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  return permissions
    .filter(
      (value) => typeof value !== "string" || !isRegistryPermission(value),
    )
    .map((value) => String(value));
}

export function principalWhere(who: GrantPrincipal): BindingPrincipalWhere {
  switch (who.type) {
    case "user":
      return { userId: who.id };
    case "group":
      return { groupId: who.id };
    case "apiKey":
      return { apiKeyId: who.id };
    default: {
      const unreachable: never = who;
      throw new Error(
        `unhandled grant principal: ${JSON.stringify(unreachable)}`,
      );
    }
  }
}
