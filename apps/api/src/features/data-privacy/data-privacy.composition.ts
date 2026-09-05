/**
 * A project's scoped privacy rules, composed as its own feature. `dataPrivacy.*` — the
 * snapshot the settings screen renders, and the two writes that set and clear a rule at a
 * scope.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import {
  DataPrivacyPermissionsPort,
  DataPrivacyScopeAuthorizationService,
  DataPrivacySnapshotService,
  PrismaDataPrivacyAdapter,
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyTrpcPorts,
} from "@langwatch/data-privacy-server";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import { createDataPrivacyTrpcRouter, type DataPrivacyTrpcChecks } from "./data-privacy-trpc.mount";

/** The two directories the privacy cascade is resolved through. */
export type DataPrivacyPeers = Readonly<{
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /** Resolves a team's organization, for a TEAM-scoped rule. */
  organizations: OrganizationService;
}>;

/** The one namespace, built over the composed rules. */
export type ComposedDataPrivacyFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createDataPrivacyTrpcRouter>;
}>;

/** The three answers the privacy surface needs from this deployment. */
type ApiDataPrivacyPorts = DataPrivacyTrpcPorts<DataPrivacySnapshot, DataPrivacyPolicy>;

/** Composes the privacy surface over this process's own graph. */
export function composeDataPrivacyFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DataPrivacyPeers;
}): ComposedDataPrivacyFeature {
  const { prisma, authz } = options.infrastructure;
  const { projects, organizations } = options.peers;

  const directory = PrismaDataPrivacyDirectoryRepository.create(prisma);
  const permissions = ApiDataPrivacyPermissions.create({ authz });
  const policies = PrismaDataPrivacyAdapter.create({ prisma, projects, organizations });
  const snapshots = DataPrivacySnapshotService.create({ policies, directory, permissions });
  const scopeAuthorization = DataPrivacyScopeAuthorizationService.create({
    directory,
    permissions,
  });

  const ports: ApiDataPrivacyPorts = {
    getSnapshot: (ctx, input): Promise<DataPrivacySnapshot> =>
      snapshots.getSnapshot({ userId: actorId(ctx), projectId: input.projectId }),

    setForScope: async (
      ctx,
      input: Readonly<{
        projectId: string;
        scope: DataPrivacyScope;
        personalOnly: boolean;
        config: DataPrivacyConfig;
      }>,
    ): Promise<DataPrivacyPolicy> => {
      const organizationId = await authorizeScopeWrite({
        scopeAuthorization,
        projects,
        userId: actorId(ctx),
        projectId: input.projectId,
        scope: input.scope,
      });
      return policies.setForScope({
        organizationId,
        scope: input.scope,
        personalOnly: input.personalOnly,
        config: input.config,
      });
    },

    removeForScope: async (
      ctx,
      input: Readonly<{ projectId: string; scope: DataPrivacyScope; personalOnly: boolean }>,
    ): Promise<void> => {
      const organizationId = await authorizeScopeWrite({
        scopeAuthorization,
        projects,
        userId: actorId(ctx),
        projectId: input.projectId,
        scope: input.scope,
      });
      await policies.removeForScope({
        organizationId,
        scope: input.scope,
        personalOnly: input.personalOnly,
      });
    },
  };

  return {
    router: (mount) => createDataPrivacyTrpcRouter({ ...mount, ports, checks: scopeChecks(mount) }),
  };
}

/**
 * The privacy surface on a process that composed no database or no project directory.
 */
export function refusingDataPrivacyFeature(): ComposedDataPrivacyFeature {
  const refuse = (): never => {
    throw new ApiDataPrivacyUnavailableError("The privacy rules");
  };
  const ports = new Proxy({}, { get: () => refuse, has: () => true }) as ApiDataPrivacyPorts;

  return {
    router: (mount) => createDataPrivacyTrpcRouter({ ...mount, ports, checks: scopeChecks(mount) }),
  };
}

/**
 * What each rule write claims about the project id it accepts, written where the
 * enforcement is.
 */
function scopeChecks(mount: ApiTrpcFeatureMount): DataPrivacyTrpcChecks {
  return {
    write: mount.middlewares.declaredCheck({
      kind: "service-authorized",
      reason:
        "the data-privacy port anchors the scope to this project's organization and then authorizes the write at the target scope's own tier",
      permissions: ["project:update"],
      enforces: {
        projectId:
          "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the write",
      },
    }),
    removal: mount.middlewares.declaredCheck({
      kind: "service-authorized",
      reason:
        "the data-privacy port anchors the scope to this project's organization and then authorizes the removal at the target scope's own tier",
      permissions: ["project:update"],
      enforces: {
        projectId:
          "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the removal",
      },
    }),
  };
}

/**
 * Anchors a rule write to the acting project's organization and authorizes it at the
 * TARGET scope's own tier, then answers which organization the write lands in.
 */
async function authorizeScopeWrite(input: {
  scopeAuthorization: DataPrivacyScopeAuthorizationService;
  projects: ProjectService;
  userId: string;
  projectId: string;
  scope: DataPrivacyScope;
}): Promise<string> {
  await input.scopeAuthorization.assertScopeBelongsToProjectOrganization({
    projectId: input.projectId,
    scope: input.scope,
  });
  await input.scopeAuthorization.assertCanWriteScope({
    userId: input.userId,
    scope: input.scope,
  });
  const project = await input.projects.getWithTeam(input.projectId);
  return project.team.organizationId;
}

/**
 * The privacy tiers' permission answers, over the SAME AuthZ service the declared check
 * on the same procedure asks.
 */
class ApiDataPrivacyPermissions extends DataPrivacyPermissionsPort {
  static create(dependencies: { authz: AuthzService }): ApiDataPrivacyPermissions {
    return new ApiDataPrivacyPermissions(dependencies.authz);
  }

  private constructor(private readonly authz: AuthzService) {
    super();
  }

  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.authz.hasPermission({
      userId: input.userId,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  async canManageTeams(input: {
    userId: string;
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.teamIds.length === 0) return new Map();
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "team:manage",
      organizationId: input.organizationId,
      teams: input.teamIds.map((teamId) => ({ teamId })),
      projects: [],
    });
    return decided.teams;
  }

  async canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.projectIds.length === 0) return new Map();
    // A personal-account project has no organization, and the batched read is
    // organization-shaped. One probe per id is exact there, and the list is
    // never longer than one.
    if (!input.organizationId) {
      const decided = await Promise.all(
        input.projectIds.map(
          async (projectId) =>
            [
              projectId,
              await this.authz.hasPermission({
                userId: input.userId,
                permission: "project:update",
                projectId,
              }),
            ] as const,
        ),
      );
      return new Map(decided);
    }
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "project:update",
      organizationId: input.organizationId,
      teams: [],
      projects: input.projectIds.map((projectId) => ({ projectId })),
    });
    return decided.projects;
  }
}

/** A capability this deployment did not compose, refused by name. */
class ApiDataPrivacyUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} are not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiDataPrivacyUnavailableError";
  }
}

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;
