import type { AuthzApi } from "@langwatch/authz-contract";
import {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
  codingAgentServer,
  type CodingAgentBillingPolicyPort,
  type CodingAgentClickHousePort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentScopeProject,
} from "@langwatch/coding-agent-server";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { composeGithubApi, PostgresGithubRepositories } from "@langwatch/github-server";
import { GithubApi, type GithubServerConfig } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

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
  app: CodingAgentApi;
  github: GithubApi;
}>;

/**
 * Builds the coding-agent read application over the worker's existing graph, booted
 * through the same `createApp().withModule().boot()` path every other module boots
 * through, rather than a hand-built `CodingAgentApp.create(...)` call.
 * The app owns its projection adapter, while the event pipeline owns its
 * processing adapter over the same tenant-keyed ClickHouse storage.
 */
export async function createWorkerCodingAgentApp(options: {
  database: PrismaConnection["client"];
  organizations: OrganizationApi;
  projects: ProjectApi;
  authorization: AuthzApi;
  billing: CodingAgentBillingPolicyPort;
  clickHouse: CodingAgentClickHousePort | null;
  defaultTraceRetentionDays: number;
  redis: WorkerGithubRedisConnection | null;
  github: GithubServerConfig;
  signingKey: string;
}): Promise<WorkerCodingAgent> {
  const github = composeGithubApi({
    repositories: PostgresGithubRepositories.create({ prisma: options.database }),
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

  const runtime = await createApp({ name: "langwatch-worker" })
    .withInfrastructure({})
    .withProvided(ProjectApi, options.projects)
    .withProvided(GithubApi, github)
    .withModule(codingAgentServer, {
      infrastructure: {
        clickHouse: options.clickHouse,
        defaultTraceRetentionDays: options.defaultTraceRetentionDays,
        billing: options.billing,
        scopeDirectory: new WorkerCodingAgentScopeDirectory(options.database),
        scopePermissions: new WorkerCodingAgentScopePermissions(options.authorization),
        // The worker serves nobody: it projects sessions and never answers a read
        // on behalf of a viewer, so a visibility question here is a wiring bug
        // rather than a redaction, and the audit trail belongs to the door that
        // does answer one.
        visibility: {
          readVisibility: () =>
            Promise.reject(
              new Error("The worker resolves no viewer, so it reads no content visibility"),
            ),
        },
        audit: {
          auditLog: () =>
            Promise.reject(new Error("The worker answers no read that names people")),
        },
      },
    })
    .boot({ role: "worker" });

  return { app: runtime.module(codingAgentServer).provided, github };
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
