import {
  type AuthzPermission,
  type DeclaredScopeId,
  PermissionDeniedError,
  type PermissionScopeArg,
  type TierOfScopeArg,
} from "@langwatch/authz";
import { type Authorized, mintWitness } from "@langwatch/authz/witness";
import type { Permission } from "~/server/api/rbac";
import type {
  ApiKeyPermissionCheck,
  CredentialDecisionRepository,
  ProjectScope,
} from "./credential-decision.repository";
import {
  LiteMemberRestrictedError,
  ProjectPermissionDeniedError,
} from "./errors";
import type {
  PermissionDecision,
  PermissionDecisionRepository,
} from "./permission-decision.repository";

/**
 * The answer for a credential check scoped to a project the request names
 * only by id. `project_not_found` covers both a missing project and one in
 * another organization — its existence is not the caller's to learn.
 */
export type ApiKeyProjectDecision =
  | { outcome: "project_not_found" }
  | { outcome: "denied" }
  | { outcome: "allowed"; scope: ProjectScope };

/**
 * Service responsible for permission enforcement.
 *
 * Pure business logic — no tRPC dependency, no client: decisions come from
 * the injected {@link PermissionDecisionRepository} (compose via
 * `permissionsServiceFor` in `./runtime.ts`). Safe to call from Hono routes,
 * background workers, or any other non-tRPC surface.
 */
export class PermissionsService {
  private readonly repository: PermissionDecisionRepository;
  private readonly credentials: CredentialDecisionRepository;

  constructor({
    decisions,
    credentials,
  }: {
    /** User-grant decisions (tRPC declarations, session surfaces). */
    decisions: PermissionDecisionRepository;
    /** API-key credential decisions (REST key middlewares, ceilings). */
    credentials: CredentialDecisionRepository;
  }) {
    this.repository = decisions;
    this.credentials = credentials;
  }

  /**
   * Asserts that a user holds the given permission on a project.
   *
   * Throws {@link LiteMemberRestrictedError} when the denial is caused by the
   * user being a Lite Member (EXTERNAL org role), and
   * {@link ProjectPermissionDeniedError} for every other denial (not a member,
   * or a member whose role does not carry the permission). Both are handled
   * errors carrying a code — callers must never tell them apart by message.
   *
   * @param params.userId     - The authenticated user's ID.
   * @param params.projectId  - The project being accessed.
   * @param params.permission - The permission that must be held.
   */
  async requireProjectPermission({
    userId,
    projectId,
    permission,
  }: {
    userId: string;
    projectId: string;
    permission: Permission;
  }): Promise<void> {
    const { permitted, organizationRole } =
      await this.repository.findProjectDecision({
        userId,
        projectId,
        permission,
      });

    if (!permitted) {
      if (organizationRole === "EXTERNAL") {
        throw new LiteMemberRestrictedError(
          permission.split(":")[0] ?? "unknown",
        );
      }
      throw new ProjectPermissionDeniedError(permission);
    }
  }

  /**
   * ADR-092 decision 25 — the typed imperative check. The scope argument is
   * derived from the permission's registry tiers: exactly one id, at a tier
   * the permission can be granted at, or the call does not compile. Decides
   * through the same repository every declared `.permission()` runs, so an
   * imperative site and a declared one can never disagree.
   */
  async hasPermission<P extends AuthzPermission>(
    check: { userId: string; permission: P } & PermissionScopeArg<P>,
  ): Promise<boolean> {
    const scope = scopeOf(check);
    if (!scope) return false;
    const { permitted } = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });
    return permitted;
  }

  /**
   * The asserting form of {@link hasPermission}: throws the engine's one
   * denial (`permission_denied`, with the permission and tier in `meta`), or
   * the lite-member restriction where that is the cause. On success it
   * returns the {@link Authorized} witness for the decided scope — a
   * function that takes the witness instead of a raw id cannot be reached by
   * a path that skipped this check.
   */
  async requirePermission<
    P extends AuthzPermission,
    A extends PermissionScopeArg<P>,
  >(
    check: { userId: string; permission: P } & A,
  ): Promise<Authorized<TierOfScopeArg<A>>> {
    const scope = scopeOf(check);
    if (!scope) {
      throw new PermissionDeniedError({
        permission: check.permission,
        scope: { type: "project", id: "unresolved" },
        denialReason: "no-binding",
      });
    }
    const { permitted, organizationRole } = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });
    if (permitted) {
      // `scope.tier` is the wide `BindingScopeTier` union; the check's own
      // arg proves it is `TierOfScopeArg<A>` here. Narrow at the mint so the
      // witness carries both the tier AND the permission (`Authorized<Tier,
      // P>`) rather than casting the whole witness after the fact — a
      // post-hoc cast no longer overlaps now the type is two-parameter.
      return mintWitness({
        tier: scope.tier as TierOfScopeArg<A>,
        id: scope.id,
        permission: check.permission,
      });
    }
    if (organizationRole === "EXTERNAL") {
      throw new LiteMemberRestrictedError(
        check.permission.split(":")[0] ?? "unknown",
      );
    }
    throw new PermissionDeniedError({
      permission: check.permission,
      scope: { type: scope.tier, id: scope.id },
      denialReason: "no-binding",
    });
  }

  /**
   * The decision at an already-resolved scope — what the declared tRPC seam
   * calls after `declaredScopeId` picks the tier. Each tier maps to the
   * repository method whose answer the legacy middleware for that tier gave.
   */
  async getDecision({
    userId,
    permission,
    scope,
  }: {
    userId: string;
    permission: AuthzPermission;
    scope: DeclaredScopeId;
  }): Promise<PermissionDecision> {
    switch (scope.tier) {
      case "project":
        return await this.repository.findProjectDecision({
          userId,
          projectId: scope.id,
          permission,
        });
      case "team":
        return await this.repository.findTeamDecision({
          userId,
          teamId: scope.id,
          permission,
        });
      case "organization":
        return await this.repository.findOrganizationDecision({
          userId,
          organizationId: scope.id,
          permission,
        });
    }
  }

  /**
   * Whether an API-key credential holds `permission` at `scope` —
   * `effective = ApiKey.bindings ∩ owning user's bindings`. The check behind
   * every REST credential authorization (org apps, the API-key ceiling, the
   * management API).
   */
  async hasApiKeyPermission(check: ApiKeyPermissionCheck): Promise<boolean> {
    return await this.credentials.findApiKeyDecision(check);
  }

  /**
   * An API-key credential's decision for a project it names only by id:
   * resolves the project's tenancy coordinates, refuses cross-organization
   * ids as not-found, then checks the permission at the project's scope.
   */
  async getApiKeyProjectDecision({
    apiKeyId,
    userId,
    organizationId,
    projectId,
    permission,
  }: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<ApiKeyProjectDecision> {
    const scope = await this.credentials.findProjectScope({ projectId });
    if (!scope || scope.organizationId !== organizationId) {
      return { outcome: "project_not_found" };
    }
    const allowed = await this.credentials.findApiKeyDecision({
      apiKeyId,
      userId,
      organizationId,
      scope: { type: "project", id: scope.projectId, teamId: scope.teamId },
      permission,
    });
    return allowed ? { outcome: "allowed", scope } : { outcome: "denied" };
  }

  /**
   * Any one of `permissions` at the project scope is enough — the decision
   * behind `.permissionAny()`.
   */
  async getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision> {
    return await this.repository.findProjectAnyDecision({
      userId,
      projectId,
      permissions,
    });
  }
}

/**
 * The typed scope argument is exclusive by construction, so exactly one id is
 * present; null is the fail-closed answer for the day the types are bypassed.
 */
function scopeOf(
  scope: Partial<Record<"projectId" | "teamId" | "organizationId", string>>,
): DeclaredScopeId | null {
  if (scope.projectId) return { tier: "project", id: scope.projectId };
  if (scope.teamId) return { tier: "team", id: scope.teamId };
  if (scope.organizationId)
    return { tier: "organization", id: scope.organizationId };
  return null;
}
