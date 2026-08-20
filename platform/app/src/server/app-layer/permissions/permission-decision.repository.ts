/**
 * ADR-092 decision 25 — the ONE data seam behind every permission check,
 * imperative and declared alike. Only this repository touches the client;
 * the service above it takes the repository, and the boundaries take the
 * service.
 *
 * The implementation delegates to the fork-aware resolvers in `rbac.ts`:
 * a not-yet-cut-over organization is decided by the legacy walk with the
 * engine shadowing, a cut-over one by the engine with legacy as
 * reverse-shadow. The contract PR rewires ONLY this class onto the engine —
 * nothing above it learns.
 */
import type { AuthzPermission } from "@langwatch/authz";
import type {
  OrganizationUserRole,
  PrismaClient,
} from "~/generated/prisma/client";
import {
  hasOrganizationPermission,
  resolveProjectPermission,
  resolveProjectPermissionAny,
  resolveTeamPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";

export type PermissionDecision = {
  permitted: boolean;
  organizationRole: OrganizationUserRole | null;
};

export interface PermissionDecisionRepository {
  findProjectDecision(params: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
  findProjectAnyDecision(params: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision>;
  findTeamDecision(params: {
    userId: string;
    teamId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
  findOrganizationDecision(params: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
}

export class ForkAwarePermissionDecisionRepository
  implements PermissionDecisionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findProjectDecision({
    userId,
    projectId,
    permission,
  }: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    return await resolveProjectPermission(
      this.resolverContextFor(userId),
      projectId,
      permission,
    );
  }

  async findProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision> {
    return await resolveProjectPermissionAny(
      this.resolverContextFor(userId),
      projectId,
      permissions,
    );
  }

  async findTeamDecision({
    userId,
    teamId,
    permission,
  }: {
    userId: string;
    teamId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    return await resolveTeamPermission(
      this.resolverContextFor(userId),
      teamId,
      permission,
    );
  }

  async findOrganizationDecision({
    userId,
    organizationId,
    permission,
  }: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    return {
      permitted: await hasOrganizationPermission(
        this.resolverContextFor(userId),
        organizationId,
        permission,
      ),
      // The organization walk carries no membership role in its answer, and
      // legacy never put one on the context either.
      organizationRole: null,
    };
  }

  /**
   * The resolvers grew up inside tRPC middleware, so they take a request
   * context — of which they read only `prisma` and `session.user.id`. This
   * shim is the single place that legacy shape is manufactured; it goes with
   * the resolvers when the contract PR lands.
   */
  private resolverContextFor(userId: string): {
    prisma: PrismaClient;
    session: Session;
  } {
    return {
      prisma: this.prisma,
      session: { user: { id: userId }, expires: "" } satisfies Session,
    };
  }
}
