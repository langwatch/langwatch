/**
 * ADR-092 decision 25 — the credential half of the permission seam: what an
 * API key may do, as opposed to what a signed-in user may do
 * (`permission-decision.repository.ts`). A separate repository because it is
 * a separate legacy seam (`role-binding-resolver.ts`, the
 * `ApiKey ∩ owning user` ceiling) with its own module graph; the service
 * composes both.
 */
import type { AuthzPermission } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  resolveApiKeyPermission,
  type ScopeRef,
} from "~/server/rbac/role-binding-resolver";

/** The tenancy coordinates of a project, for scoping a credential check. */
export type ProjectScope = {
  projectId: string;
  teamId: string;
  organizationId: string;
};

export type ApiKeyPermissionCheck = {
  apiKeyId: string;
  /** Null for service keys, which have no owning-user ceiling. */
  userId: string | null;
  organizationId: string;
  scope: ScopeRef;
  permission: AuthzPermission;
};

export interface CredentialDecisionRepository {
  /**
   * Whether an API-key credential holds `permission` at `scope`:
   * `effective = ApiKey.bindings ∩ owning user's bindings`, the resolution
   * the legacy `resolveApiKeyPermission` performs.
   */
  findApiKeyDecision(check: ApiKeyPermissionCheck): Promise<boolean>;
  /**
   * A project's tenancy coordinates, or null when no such project exists.
   * Read by credential checks that must scope to a project the request only
   * names by id.
   */
  findProjectScope(params: { projectId: string }): Promise<ProjectScope | null>;
}

export class ForkAwareCredentialDecisionRepository
  implements CredentialDecisionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findApiKeyDecision({
    apiKeyId,
    userId,
    organizationId,
    scope,
    permission,
  }: ApiKeyPermissionCheck): Promise<boolean> {
    return await resolveApiKeyPermission({
      prisma: this.prisma,
      apiKeyId,
      userId,
      organizationId,
      scope,
      permission,
    });
  }

  async findProjectScope({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectScope | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        team: { select: { id: true, organizationId: true } },
      },
    });
    if (!project) return null;
    return {
      projectId: project.id,
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }
}
