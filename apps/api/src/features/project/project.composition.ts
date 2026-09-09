/**
 * `project.*` — one project's lifecycle and its settings form — composed as its own
 * feature.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { ProjectApp } from "@langwatch/project-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { ApiAuditPort } from "../../api-request.policy.ts";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiViewerProtectionsPort } from "../trace/trace-viewer-protections.ts";
import { createProjectTrpcRouter, type ProjectBrowserPorts } from "./project-trpc.mount.ts";

/** The other services one project's own surfaces reach. */
export type ProjectPeers = Readonly<{
  /** The project directory the tenancy graph composed. */
  organizations: OrganizationApi;
  /** The credential service the API doors already authenticate through. */
  apiKeys: ApiKeyApi;
  /** The share ledger the trace group composed: one project, one sharing rule. */
  share: ShareApi;
  /** The topic tree the trace group composed. */
  topics: TopicApi;
  /** The deployment's cipher, for a project's object-storage credentials. */
  encryption: SecretEncryptionPort | undefined;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtectionsPort | undefined;
}>;

import type { ComposedProjectFeature } from "./project.composition.types.ts";

/** Composes `project.*` over this process's own graph. */
export function composeProjectFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: ProjectPeers;
}): ComposedProjectFeature {
  const logger = createLogger("langwatch:api:project");

  const app = ProjectApp.create({
    infrastructure: {
      database: options.infrastructure.prisma,
      topicClustering: {
        requestClustering: () =>
          Promise.reject(
            new ApiProjectUnavailableError(
              "topic-clustering scheduler, so it cannot start a clustering run",
            ),
          ),
      },
    },
    dependencies: {
      organizations: options.peers.organizations,
      apiKeys: options.peers.apiKeys,
      share: options.peers.share,
      topics: options.peers.topics,
    },
  });

  return { app, router: (mount) => createProjectTrpcRouter(mount.runtime, projectPorts(options, logger)) };
}

/**
 * The six answers `project.*` needs that the project does not own, over this
 * process's own cipher, AuthZ service, protections resolver and audit trail.
 */
function projectPorts(
  options: Readonly<{ infrastructure: ApiTrpcInfrastructure; peers: ProjectPeers }>,
  logger: Logger,
): ProjectBrowserPorts {
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
    probePermission: ({ userId, permission, scope }) =>
      options.infrastructure.authz.hasPermission({
        userId,
        permission,
        ...scopeIdOf(scope),
      }),
    getFieldProtections: (input) => {
      const protections = peers.viewerProtections;
      if (!protections) {
        return Promise.reject(
          new ApiProjectUnavailableError(
            "content-protections resolver, so it cannot say what this viewer may read of a project",
          ),
        );
      }
      return protections.readViewerProtections(input);
    },
    // Best effort by the port's own contract: a project is created whether or
    // not Langy gets a key, and the credential service mints one on the first
    // chat call.
    provisionLangyVirtualKey: (input) => {
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
  };
}

/** The one id field the AuthZ probe names for the tier a scope was asked at. */
function scopeIdOf(
  scope: Readonly<{ tier: "project" | "team" | "organization"; id: string }>,
): Readonly<{ projectId?: string; teamId?: string; organizationId?: string }> {
  if (scope.tier === "project") return { projectId: scope.id };
  if (scope.tier === "team") return { teamId: scope.id };

  return { organizationId: scope.id };
}

/**
 * `project.*` on a process that composed no project directory. The namespace still mounts
 * and every call refuses by name: a settings form that rendered empty would tell somebody
 * their project has no settings.
 */
export function refusingProjectFeature(): ComposedProjectFeature {
  const refuse = (): never => {
    throw new ApiProjectUnavailableError("project directory");
  };

  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<ProjectApi>(),
    router: (mount) => createProjectTrpcRouter(mount.runtime, refuseEvery<ProjectBrowserPorts>()),
  };
}


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
