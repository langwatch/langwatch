/**
 * `codingAgents.*` — what the coding agents did inside a tenant's projects — composed as
 * its own feature.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  CodingAgentApp,
  CodingAgentBillingPolicyPort,
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
  type CodingAgentClickHousePort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentAuditPort,
  type CodingAgentScopeProject,
  type CodingAgentViewerVisibility,
  type CodingAgentViewerVisibilityPort,
} from "@langwatch/coding-agent-server";
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiViewerProtectionsPort } from "../trace/trace-viewer-protections.ts";
import { createCodingAgentTrpcRouter } from "./coding-agent-trpc.mount.ts";

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

/** Where a coding-agent read that names people is written down. */
export type CodingAgentAudit = Readonly<{
  record(event: { actorId: string; path: string; input: unknown; error: unknown }): Promise<void>;
}>;

import type { ComposedCodingAgentFeature } from "./coding-agent.composition.types.ts";

/** Composes `codingAgents.*` over this process's own graph. */
export function composeCodingAgentFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: CodingAgentPeers;
  /** The retention a projected session is stamped with, from the process's config. */
  defaultRetentionDays: number;
  /** The trail every read that names people is recorded on, where composed. */
  audit?: CodingAgentAudit | undefined;
}): ComposedCodingAgentFeature {
  const app = composeCodingAgentApp(options);

  return { app, service: app, router: (mount) => createCodingAgentTrpcRouter(mount.runtime) };
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
    router: (mount) => createCodingAgentTrpcRouter(mount.runtime),
  };
}

/**
 * The coding-agent application, over this process's own ClickHouse and the
 * GitHub App it was configured with.
 */
function composeCodingAgentApp(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: CodingAgentPeers;
  defaultRetentionDays: number;
  audit?: CodingAgentAudit | undefined;
}): CodingAgentApp {
  const { peers } = options;
  return CodingAgentApp.create({
    dependencies: { github: peers.github, projects: peers.projects },
    infrastructure: {
      clickHouse: peers.clickHouse,
      defaultTraceRetentionDays: options.defaultRetentionDays,
      billing: new ApiCodingAgentBilling(),
      scopeDirectory: new ApiCodingAgentScopeDirectory(options.infrastructure.prisma),
      scopePermissions: new ApiCodingAgentScopePermissions(options.infrastructure.authz),
      visibility: apiCodingAgentVisibility(peers.viewerProtections),
      audit: apiCodingAgentAudit(options.audit),
    },
    config: undefined,
    resources: new ResourceScope(),
  });
}

/**
 * What one viewer may see of one project: whether captured content is readable,
 * and whether spend is. The SAME resolution the five trace surfaces read
 * through, so a session list and the traces behind it cannot disagree.
 */
function apiCodingAgentVisibility(
  protections: ApiViewerProtectionsPort | undefined,
): CodingAgentViewerVisibilityPort {
  return {
    readVisibility: async (input): Promise<CodingAgentViewerVisibility> => {
      if (!protections) {
        throw new ApiCodingAgentUnavailableError(
          "content-protections resolver, so it cannot say what this viewer may read of a coding-agent session",
        );
      }
      const resolved = await protections.readViewerProtections(input);

      return {
        canReadCapturedContent:
          resolved.canSeeCapturedInput === true && resolved.canSeeCapturedOutput === true,
        canSeeCosts: resolved.canSeeCosts === true,
      };
    },
  };
}

/**
 * Where a read that names people is written down. A deployment that composed no
 * trail records nothing rather than refusing the read: the answer is the same
 * either way, and the audit is the deployment's own decision.
 */
function apiCodingAgentAudit(audit: CodingAgentAudit | undefined): CodingAgentAuditPort {
  return {
    auditLog: async (entry) => {
      await audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: {
          organizationId: entry.organizationId,
          targetId: entry.targetId,
          ...entry.args,
        },
        error: null,
      });
    },
  };
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
