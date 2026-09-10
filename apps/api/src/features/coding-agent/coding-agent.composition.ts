/**
 * `codingAgents.*` — what the coding agents did inside a tenant's projects — composed as
 * its own feature.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  CodingAgentBillingPolicy,
  CodingAgentCallerScopeDirectory,
  CodingAgentScopePermissions,
  CodingAgentUnavailableError,
  codingAgentServer,
  type CodingAgentClickHouse,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentAuditPort,
  type CodingAgentScopeProject,
  type CodingAgentViewerVisibility,
  type CodingAgentViewerVisibilityPort,
} from "@langwatch/coding-agent-server";
import { GithubApi } from "@langwatch/github-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiViewerProtections } from "../trace/trace-viewer-protections.ts";
import { createCodingAgentTrpcRouter } from "./coding-agent-trpc.mount.ts";
import type { ComposedCodingAgentFeature } from "./coding-agent.composition.types.ts";

/** The other services and stores one project's coding agents are read over. */
export type CodingAgentPeers = Readonly<{
  /** The project directory the tenancy graph composed. */
  projects: ProjectApi;
  /** The GitHub App this deployment registered, blank where it registered none. */
  github: GithubApi;
  /** This process's ClickHouse, where the sessions are projected. */
  clickHouse: CodingAgentClickHouse | null;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtections | undefined;
}>;

/** Where a coding-agent read that names people is written down. */
export type CodingAgentAudit = Readonly<{
  record(event: { actorId: string; path: string; input: unknown; error: unknown }): Promise<void>;
}>;

/**
 * Installs `codingAgents.*` over this process's own graph: `defineModule("coding-agent")`
 * booted through the same `createApp().withModule().boot()` path every other module
 * boots through, rather than a hand-built `CodingAgentApp.create(...)` call.
 */
export async function composeCodingAgentFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: CodingAgentPeers;
  /** The retention a projected session is stamped with, from the process's config. */
  defaultRetentionDays: number;
  /** The trail every read that names people is recorded on, where composed. */
  audit?: CodingAgentAudit | undefined;
}): Promise<ComposedCodingAgentFeature> {
  const { peers } = options;

  // A process with no ClickHouse holds the projections in memory instead: the
  // API folds no session, so an empty memory tier answers exactly what the
  // absent store would, and the module composes the same way either way.
  const persistence = peers.clickHouse
    ? {
        backend: "clickhouse",
        infrastructure: {
          clickhouse: peers.clickHouse,
          defaultRetentionDays: options.defaultRetentionDays,
        },
      }
    : { backend: "memory", infrastructure: {} };

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence(persistence.backend, persistence.infrastructure)
    .withInfrastructure({})
    .withProvided(ProjectApi, peers.projects)
    .withProvided(GithubApi, peers.github)
    .withModule(codingAgentServer, {
      infrastructure: {
        billing: new ApiCodingAgentBilling(),
        scopeDirectory: new ApiCodingAgentScopeDirectory(options.infrastructure.prisma),
        scopePermissions: new ApiCodingAgentScopePermissions(options.infrastructure.authz),
        visibility: apiCodingAgentVisibility(peers.viewerProtections),
        audit: apiCodingAgentAudit(options.audit),
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(codingAgentServer).provided;

  return { app, service: app, router: (mount) => createCodingAgentTrpcRouter(mount.runtime) };
}

/**
 * What one viewer may see of one project: whether captured content is readable,
 * and whether spend is. The SAME resolution the five trace surfaces read
 * through, so a session list and the traces behind it cannot disagree.
 */
function apiCodingAgentVisibility(
  protections: ApiViewerProtections | undefined,
): CodingAgentViewerVisibilityPort {
  return {
    readVisibility: async (input): Promise<CodingAgentViewerVisibility> => {
      if (!protections) {
        throw new CodingAgentUnavailableError(
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
class ApiCodingAgentBilling extends CodingAgentBillingPolicy {
  isSourceNonBillable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * The organization's projects and the person behind each personal workspace, over this
 * process's own connection.
 */
export class ApiCodingAgentScopeDirectory extends CodingAgentCallerScopeDirectory {
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
export class ApiCodingAgentScopePermissions extends CodingAgentScopePermissions {
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
