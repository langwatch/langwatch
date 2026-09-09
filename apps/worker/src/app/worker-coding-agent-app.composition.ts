import type { AuthzApi } from "@langwatch/authz-contract";
import {
  CodingAgentApp,
  type CodingAgentBillingPolicyPort,
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
  type CodingAgentClickHousePort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentScopeProject,
} from "@langwatch/coding-agent-server";
import { PostgresGithubAdapter, type GithubDatabase } from "@langwatch/github-server";
import type { GithubApi, GithubServerConfig } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ResourceOwnership } from "@langwatch/runtime-composition";

/** Minimal Redis surface owned by GitHub's private adapter. */
export type WorkerGithubRedisConnection = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  getdel?: (key: string) => Promise<string | null>;
  eval?: (script: string, numKeys: number, ...args: string[]) => Promise<number | string | null>;
};

/** The composed worker capability and its shared projection persistence. */
export type WorkerCodingAgent = Readonly<{
  app: CodingAgentApp;
  github: GithubApi;
}>;

/**
 * Builds the coding-agent read application over the worker's existing graph.
 * The app owns its projection adapter, while the event pipeline owns its
 * processing adapter over the same tenant-keyed ClickHouse storage.
 */
export function createWorkerCodingAgentApp(options: {
  database: PrismaConnection["client"] & GithubDatabase;
  organizations: OrganizationApi;
  projects: ProjectApi;
  authorization: AuthzApi;
  billing: CodingAgentBillingPolicyPort;
  clickHouse: CodingAgentClickHousePort | null;
  defaultTraceRetentionDays: number;
  redis: WorkerGithubRedisConnection | null;
  github: GithubServerConfig;
  signingKey: string;
  resources: ResourceOwnership;
}): WorkerCodingAgent {
  const github = PostgresGithubAdapter.create({
    database: options.database,
    redis: options.redis,
    organization: options.organizations,
    project: options.projects,
    config: {
      appId: options.github.appId ?? "",
      privateKey: options.github.privateKey ?? "",
      appSlug: options.github.appSlug ?? "",
      webhookSecret: options.github.webhookSecret ?? "",
      signingKey: options.signingKey,
    },
    ...(options.github.host === undefined ? {} : { hostConfig: { host: options.github.host } }),
  });

  const app = CodingAgentApp.create({
    infrastructure: {
      clickHouse: options.clickHouse,
      defaultTraceRetentionDays: options.defaultTraceRetentionDays,
      billing: options.billing,
      scopeDirectory: new WorkerCodingAgentScopeDirectory(options.database),
      scopePermissions: new WorkerCodingAgentScopePermissions(options.authorization),
    },
    dependencies: { github, projects: options.projects },
    config: undefined,
    resources: options.resources,
  });

  return { app, github };
}

class WorkerCodingAgentScopeDirectory extends CodingAgentCallerScopeDirectoryPort {
  constructor(private readonly database: PrismaConnection["client"]) {
    super();
  }

  listOrganizationProjects(input: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]> {
    return this.database.project.findMany({
      where: { team: { organizationId: input.organizationId }, archivedAt: null },
      select: { id: true, name: true, slug: true, teamId: true, isPersonal: true },
    });
  }

  async listPersonalTeamOwnerNames(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (input.teamIds.length === 0) return new Map();
    const members = await this.database.teamUser.findMany({
      where: { teamId: { in: [...input.teamIds] } },
      select: { teamId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    const names = new Map<string, string>();
    for (const member of members) {
      if (names.has(member.teamId)) continue;
      const label = member.user?.name?.trim() || member.user?.email?.trim();
      if (label) names.set(member.teamId, label);
    }
    return names;
  }
}

class WorkerCodingAgentScopePermissions extends CodingAgentScopePermissionsPort {
  constructor(private readonly authorization: AuthzApi) {
    super();
  }

  async projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>> {
    const result = await this.authorization.canBatchPermissionsByIds({
      principal:
        input.caller.kind === "user"
          ? { type: "user", id: input.caller.userId }
          : { type: "apiKey", id: input.caller.apiKeyId },
      permissions: [...input.permissions],
      organizationId: input.organizationId,
      teams: [],
      projects: input.projects.map((project) => ({ projectId: project.id, teamId: project.teamId })),
    });
    return new Map(
      input.permissions.map((permission) => [
        permission,
        new Set(
          [...(result.byPermission.get(permission)?.projects ?? new Map())]
            .filter(([, allowed]) => allowed)
            .map(([projectId]) => projectId),
        ),
      ]),
    );
  }
}
