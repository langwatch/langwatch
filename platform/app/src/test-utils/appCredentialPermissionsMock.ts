import type {
  ApiKeyPermissionCheck,
  ApiKeyProjectDecision,
  AuthzGetApiKeyProjectDecisionInput,
  AuthzService,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";

class CredentialBackedTestAuthzService {
  constructor(private readonly prisma: PrismaClient) {}

  hasApiKeyPermission(check: ApiKeyPermissionCheck): Promise<boolean> {
    return resolveApiKeyPermission({ prisma: this.prisma, ...check });
  }

  async getApiKeyProjectDecision({
    apiKeyId,
    userId,
    organizationId,
    projectId,
    permission,
  }: AuthzGetApiKeyProjectDecisionInput): Promise<ApiKeyProjectDecision> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        team: { select: { id: true, organizationId: true } },
      },
    });
    if (!project || project.team.organizationId !== organizationId) {
      return { outcome: "project_not_found" };
    }
    const scope = {
      projectId: project.id,
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
    const allowed = await this.hasApiKeyPermission({
      apiKeyId,
      userId,
      organizationId,
      scope: { type: "project", id: scope.projectId, teamId: scope.teamId },
      permission,
    });
    return allowed ? { outcome: "allowed", scope } : { outcome: "denied" };
  }
}

/**
 * The authorization engine on its own, for a suite that installs an App on the
 * request context rather than replacing the singleton module.
 */
export function credentialBackedPermissions(prisma?: unknown): AuthzService {
  return new CredentialBackedTestAuthzService(
    (prisma ?? {}) as PrismaClient,
  ) as unknown as AuthzService;
}

export function appCredentialPermissionsMock(prisma?: unknown) {
  const permissions = credentialBackedPermissions(prisma);
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
