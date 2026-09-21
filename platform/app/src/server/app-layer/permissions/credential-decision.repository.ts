/** Adapts the grants engine to the permission service contract. */
import type { AuthzPermission } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  resolveApiKeyPermission,
  resolveApiKeyPermissionProjectBatch,
  type ScopeRef,
} from "~/server/app-layer/authz/credential-permissions";

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

/** The same decision as {@link ApiKeyPermissionCheck}, for a SET of project
 *  scopes and permissions in one organization, answered from one grant
 *  collection rather than one pass per project. */
export type ApiKeyProjectDecisionsQuery = {
  apiKeyId: string;
  /** Null for service keys, which have no owning-user ceiling. */
  userId: string | null;
  organizationId: string;
  projects: ReadonlyArray<{ projectId: string; teamId: string }>;
  permissions: readonly AuthzPermission[];
};

export interface CredentialDecisionRepository {
  /**
   * Whether an API-key credential holds `permission` at `scope`:
   * `effective = key grants ∩ owner grants`, the resolution
   * `resolveApiKeyPermission` performs.
   */
  findApiKeyDecision(check: ApiKeyPermissionCheck): Promise<boolean>;

  /**
   * {@link findApiKeyDecision} across many project scopes and permissions at
   * once: the same `key ∩ owner` decision per (project, permission), decided
   * against grant snapshots collected once — never one collector pass per
   * project, which is the pool-starving fan-out this batch exists to remove.
   */
  findApiKeyProjectDecisions(
    query: ApiKeyProjectDecisionsQuery,
  ): Promise<Map<AuthzPermission, Map<string, boolean>>>;
  /**
   * A project's tenancy coordinates, or null when no such project exists.
   * Read by credential checks that must scope to a project the request only
   * names by id.
   */
  findProjectScope(params: { projectId: string }): Promise<ProjectScope | null>;
}

export class EngineCredentialDecisionRepository
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

  async findApiKeyProjectDecisions(
    query: ApiKeyProjectDecisionsQuery,
  ): Promise<Map<AuthzPermission, Map<string, boolean>>> {
    return await resolveApiKeyPermissionProjectBatch({
      prisma: this.prisma,
      ...query,
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
