/**
 * `project.*` — one project's lifecycle and its settings form — composed as
 * its own feature.
 *
 * The application is the project package's own: the directory, the credential
 * service the API doors already authenticate through, the sharing rule and the
 * topic tree, all taken rather than rebuilt so the settings form and the
 * explorer cannot disagree about what a project holds.
 *
 * ## The named absences
 *
 * `project.triggerTopicClustering` refuses by name: clustering runs are
 * scheduled by the worker, and a request this process accepted would be a run
 * nobody starts. `project.provisionLangyVirtualKey` logs instead of refusing —
 * it is best-effort by the port's own contract, and a failure there must never
 * cost somebody the project they just created.
 *
 * {@link ApiViewerProtectionsPort} is what `getFieldRedactionStatus` resolves
 * a viewer's redactions through. Absent, it refuses rather than guessing:
 * guessing high would show a reader captured content they may not see, and
 * guessing low would tell them their project has nothing in it.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  declareAuthzMiddleware,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import { ProjectApp } from "@langwatch/project-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";

import type { ApiAuditPort } from "../../api-request.policy";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiViewerProtectionsPort } from "../trace/trace-viewer-protections";
import {
  createProjectTrpcRouter,
  type ProjectTrpcChecks,
  type ProjectTrpcMountPorts,
} from "./project-trpc.mount";

/** The other services one project's own surfaces reach. */
export type ProjectPeers = Readonly<{
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The credential service the API doors already authenticate through. */
  apiKeys: ApiKeyService;
  /** The share ledger the trace group composed: one project, one sharing rule. */
  share: ShareService;
  /** The topic tree the trace group composed. */
  topics: TopicService;
  /** The deployment's cipher, for a project's object-storage credentials. */
  encryption: SecretEncryptionPort | undefined;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtectionsPort | undefined;
}>;

/** The one namespace this feature mounts, and the `ctx.app.projects` slice. */
export type ComposedProjectFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createProjectTrpcRouter>;
  /** For `ctx.app.projects`, which several other namespaces read as well. */
  app: ProjectApp;
}>;

/** Composes `project.*` over this process's own graph. */
export function composeProjectFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: ProjectPeers;
}): ComposedProjectFeature {
  const logger = createLogger("langwatch:api:project");

  const app = ProjectApp.create({
    projects: options.peers.projects,
    apiKeys: options.peers.apiKeys,
    share: options.peers.share,
    topics: options.peers.topics,
    topicClustering: {
      requestClustering: () =>
        Promise.reject(
          new ApiProjectUnavailableError(
            "topic-clustering scheduler, so it cannot start a clustering run",
          ),
        ),
    } as Parameters<typeof ProjectApp.create>[0]["topicClustering"],
  });

  const ports = projectPorts(options, logger);
  const checks = projectChecks(options.infrastructure.authz);

  return {
    app,
    router: (mount) => createProjectTrpcRouter({ ...mount, ports, checks }),
  };
}

/**
 * `project.*` on a process that composed no project directory.
 *
 * The namespace still mounts and every call refuses by name: a settings form
 * that rendered empty would tell somebody their project has no settings.
 */
export function refusingProjectFeature(): ComposedProjectFeature {
  const refuse = (): never => {
    throw new ApiProjectUnavailableError("project directory");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<ProjectApp>(),
    router: (mount) =>
      createProjectTrpcRouter({
        ...mount,
        ports: refuseEvery<ProjectTrpcMountPorts>(),
        checks: {
          create: declareAuthzMiddleware(PROJECT_CREATE_DECLARATION, () => refuse()),
          traceSharing: () => refuse(),
        } as ProjectTrpcChecks,
      }),
  };
}

/** What `project.create`'s own check declares, in the check and the refusal. */
const PROJECT_CREATE_DECLARATION = {
  kind: "custom",
  reason:
    "creating into an existing team asks that team; creating a team alongside asks the organization",
  permissions: ["project:create", "organization:manage"],
} as const;

/**
 * `project.create`'s tier resolution and the trace-sharing demand.
 *
 * `create` names two tiers and acts on exactly one, decided by what was asked
 * for; the trace-sharing flip is a SECOND demand on top of the declared
 * `project:update`, applied after it, because it changes who outside the
 * project may read its traces.
 */
function projectChecks(authz: AuthzService): ProjectTrpcChecks {
  const probeTeam = (userId: string, permission: AuthzPermission, teamId: string) =>
    authz.hasPermission({ userId, permission, teamId });
  const probeOrganization = (userId: string, permission: AuthzPermission, organizationId: string) =>
    authz.hasPermission({ userId, permission, organizationId });
  const probeProject = (userId: string, permission: AuthzPermission, projectId: string) =>
    authz.hasPermission({ userId, permission, projectId });

  return {
    create: declareAuthzMiddleware(PROJECT_CREATE_DECLARATION, async (params: never) => {
      const call = params as unknown as ScopeCheckParams<{
        organizationId: string;
        teamId?: string;
        newTeamName?: string;
      }>;
      const userId = call.ctx.actor().id;
      if (!call.input.teamId && !call.input.newTeamName) {
        throw new ProjectCreateTargetMissingError();
      }
      const permitted = call.input.teamId
        ? await probeTeam(userId, "project:create", call.input.teamId)
        : await probeOrganization(userId, "organization:manage", call.input.organizationId);
      if (!permitted) throw new ProjectCreateDeniedError();
      call.ctx.permissionChecked = true;
      return call.next();
    }),
    traceSharing: async (params: unknown) => {
      const call = params as ScopeCheckParams<{
        projectId: string;
        traceSharingEnabled?: boolean;
      }>;
      if (call.input.traceSharingEnabled !== undefined) {
        const permitted = await probeProject(
          call.ctx.actor().id,
          "project:manage",
          call.input.projectId,
        );
        if (!permitted) throw new TraceSharingDeniedError();
      }
      return call.next();
    },
  };
}

/** A create named neither an existing team nor a new one. */
class ProjectCreateTargetMissingError extends HandledError {
  declare readonly code: "validation_error";

  constructor() {
    super("validation_error", "Either an existing team or a new team name must be given", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ProjectCreateTargetMissingError";
  }
}

/** The caller may not create a project at the tier they named. */
class ProjectCreateDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to create a project here", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ProjectCreateDeniedError";
  }
}

/** The caller may update the project but not change who outside it can read. */
class TraceSharingDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to change trace sharing settings", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "TraceSharingDeniedError";
  }
}

/** The six answers `project.*` needs that the project does not own. */
function projectPorts(
  options: Readonly<{ infrastructure: ApiTrpcInfrastructure; peers: ProjectPeers }>,
  logger: Logger,
): ProjectTrpcMountPorts {
  const { peers } = options;
  const audit: ApiAuditPort | undefined = options.infrastructure.audit;

  return {
    encryptProjectSecret: (value) => {
      const encryption = peers.encryption;
      if (!encryption) {
        throw new ApiProjectUnavailableError(
          "stored-secret key, so it cannot store a project's object-storage credentials",
        );
      }
      return encryption.encrypt(value);
    },
    probeProjectPermission: (ctx, projectId, permission) =>
      options.infrastructure.authz.hasPermission({
        userId: actorId(ctx),
        permission,
        projectId,
      }),
    getFieldProtections: (ctx, input) => {
      const protections = peers.viewerProtections;
      if (!protections) {
        return Promise.reject(
          new ApiProjectUnavailableError(
            "content-protections resolver, so it cannot say what this viewer may read of a project",
          ),
        );
      }
      return protections.getViewerProtections(ctx, input);
    },
    /**
     * Best effort by the port's own contract: a project is created whether or
     * not Langy gets a key, and the credential service mints one on the first
     * chat call. So an absent gateway logs rather than refusing — refusing
     * would cost somebody the project they just created.
     */
    provisionLangyVirtualKey: (_ctx, input) => {
      logger.debug(
        { projectId: input.projectId },
        "no gateway virtual-key provisioner is composed: this project starts without a Langy key, and one is minted on its first chat call",
      );
      return Promise.resolve();
    },
    recordApiKeyRegenerated: async ({ userId, projectId }) => {
      await audit?.record({
        actorId: userId,
        path: "project.apiKey.regenerated",
        input: { projectId },
        error: null,
      });
    },
    reportTopicClusteringFailure: (error, context) => {
      logger.error({ error, projectId: context.projectId }, "a clustering request failed");
    },
  } as ProjectTrpcMountPorts;
}

/** What a `kind: "custom"` check is handed on this process's root. */
type ScopeCheckParams<TInput> = {
  ctx: { actor(): { id: string }; permissionChecked?: boolean };
  input: TInput;
  next(): unknown;
};

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/** A capability this deployment did not compose, refused by name. */
export class ApiProjectUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiProjectUnavailableError";
  }
}
