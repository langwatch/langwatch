/**
 * `codingAgents.*` — what the coding agents did inside a tenant's projects — composed as
 * its own feature.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  CodingAgentApp,
  CodingAgentBillingPolicyPort,
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentCallerScopeService,
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentRuntime,
  CodingAgentScopePermissionsPort,
  type CodingAgentClickHousePort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentScopeProject,
  type CodingAgentTrpcPorts,
  type CodingAgentViewerVisibility,
} from "@langwatch/coding-agent-server";
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiViewerProtectionsPort } from "../trace/trace-viewer-protections";
import { createCodingAgentTrpcRouter } from "./coding-agent-trpc.mount";

/**
 * The platform application's `PLATFORM_DEFAULT_RETENTION_DAYS`.
 */
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

/** The other services and stores one project's coding agents are read over. */
export type CodingAgentPeers = Readonly<{
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The GitHub App this deployment registered, blank where it registered none. */
  github: GithubService;
  /** This process's ClickHouse, where the sessions are projected. */
  clickHouse: CodingAgentClickHousePort | null;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtectionsPort | undefined;
}>;

/** The one namespace this feature mounts, and its `ctx.app` application. */
export type ComposedCodingAgentFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createCodingAgentTrpcRouter>;
  /** For `ctx.app.codingAgentApp`. */
  app: CodingAgentApp;
  /**
   * The same application, where this process composed one, for the packaged coding-agent
   * REST family.
   */
  service?: CodingAgentApp | undefined;
}>;

/** Composes `codingAgents.*` over this process's own graph. */
export function composeCodingAgentFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: CodingAgentPeers;
}): ComposedCodingAgentFeature {
  const app = composeCodingAgentApp(options);
  const ports = codingAgentPorts(options.peers);

  return {
    app,
    service: app,
    router: (mount) => createCodingAgentTrpcRouter({ ...mount, ports }),
  };
}

/**
 * `codingAgents.*` on a process that composed no project graph to read them over.
 */
export function refusingCodingAgentFeature(): ComposedCodingAgentFeature {
  const refuse = (): never => {
    throw new ApiCodingAgentUnavailableError("coding-agent session store");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<CodingAgentApp>(),
    router: (mount) =>
      createCodingAgentTrpcRouter({ ...mount, ports: refuseEvery<CodingAgentTrpcPorts>() }),
  };
}

/**
 * What one viewer may see of one project: whether captured content is readable, and
 * whether spend is.
 */
function codingAgentPorts(peers: CodingAgentPeers): CodingAgentTrpcPorts {
  return {
    readViewerVisibility: async (request, input): Promise<CodingAgentViewerVisibility> => {
      const resolver = peers.viewerProtections;
      if (!resolver) {
        throw new ApiCodingAgentUnavailableError(
          "content-protections resolver, so it cannot say what this viewer may read of a coding-agent session",
        );
      }
      const protections = await resolver.getViewerProtections(request, input);
      return {
        canReadCapturedContent:
          protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true,
        canSeeCosts: protections.canSeeCosts === true,
      };
    },
  };
}

/**
 * The coding-agent application, over this process's own ClickHouse and the
 * GitHub App it was configured with.
 */
function composeCodingAgentApp(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: CodingAgentPeers;
}): CodingAgentApp {
  const { peers } = options;
  const runtime = CodingAgentRuntime.create({
    projections: CodingAgentProjectionPersistenceAdapter.create({
      clickHouse: peers.clickHouse,
      retention: { defaultTraceRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS },
    }),
    github: peers.github,
    projects: peers.projects,
    billing: new ApiCodingAgentBilling(),
  });

  const scope = CodingAgentCallerScopeService.create({
    directory: new ApiCodingAgentScopeDirectory(options.infrastructure.prisma),
    permissions: new ApiCodingAgentScopePermissions(options.infrastructure.authz),
  });

  return CodingAgentApp.create({
    codingAgents: runtime.service,
    github: peers.github,
    scope: {
      tryResolveOrganizationForProject: async (projectId) => {
        try {
          return await peers.projects.getOrganizationId(projectId);
        } catch {
          return undefined;
        }
      },
      resolveCallerProjectScope: (input) => scope.resolve(input),
    },
  });
}

/** Whether a project's traces may be persisted into a dataset without charge. */
class ApiCodingAgentBilling extends CodingAgentBillingPolicyPort {
  isSourceNonBillable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * The organization's projects and the person behind each personal workspace, over this
 * process's own connection.
 */
export class ApiCodingAgentScopeDirectory extends CodingAgentCallerScopeDirectoryPort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  listOrganizationProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]> {
    return this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true, name: true, slug: true, teamId: true, isPersonal: true },
    });
  }

  async listPersonalTeamOwnerNames({
    teamIds,
  }: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (teamIds.length === 0) return new Map();
    const members = await this.prisma.teamUser.findMany({
      where: { teamId: { in: [...teamIds] } },
      select: { teamId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    const names = new Map<string, string>();
    for (const member of members) {
      if (names.has(member.teamId)) continue;
      // The schema has no foreign keys, so a membership row can outlive its
      // user; a missing user names nothing rather than failing the read.
      const label = member.user?.name?.trim() || member.user?.email?.trim();
      if (label) names.set(member.teamId, label);
    }
    return names;
  }
}

/**
 * The two permission cuts, over the ONE AuthZ service this process decides with, in ONE
 * batched ask. `canBatchPermissionsByIds` collects the principal's grant snapshot once
 * and decides every (project, permission) pair against it in memory.
 */
export class ApiCodingAgentScopePermissions extends CodingAgentScopePermissionsPort {
  constructor(private readonly authz: AuthzService) {
    super();
  }

  async projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>> {
    const { byPermission } = await this.authz.canBatchPermissionsByIds({
      principal:
        input.caller.kind === "user"
          ? { type: "user", id: input.caller.userId }
          : { type: "apiKey", id: input.caller.apiKeyId },
      permissions: [...input.permissions],
      organizationId: input.organizationId,
      teams: [],
      projects: input.projects.map((project) => ({
        projectId: project.id,
        teamId: project.teamId,
      })),
    });

    return new Map(
      input.permissions.map((permission) => [
        permission,
        new Set(
          [...(byPermission.get(permission)?.projects ?? new Map())]
            .filter(([, allowed]) => allowed)
            .map(([projectId]) => projectId),
        ),
      ]),
    );
  }
}

/** A capability this deployment did not compose, refused by name. */
export class ApiCodingAgentUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCodingAgentUnavailableError";
  }
}
