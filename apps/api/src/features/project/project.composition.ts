/**
 * `project.*` — one project's lifecycle and its settings form — composed as its own
 * feature.
 */
import { ApiKeyApi, type ApiKeyApi as ApiKeyApiContract } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { projectServer } from "@langwatch/project-server";
import { createApp } from "@langwatch/runtime-composition";
import type { SecretEncryption } from "@langwatch/secret-server";
import { ShareApi, type ShareApi as ShareApiContract } from "@langwatch/share-contract";
import { TopicApi, type TopicApi as TopicApiContract } from "@langwatch/topic-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";

import type { ApiAuditPort } from "../../api-request.policy.ts";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiViewerProtections } from "../trace/trace-viewer-protections.ts";
import { createProjectTrpcRouter, type ProjectBrowserPorts } from "./project-trpc.mount.ts";

/** The other services one project's own surfaces reach. */
export type ProjectPeers = Readonly<{
  /** The project directory the tenancy graph composed. */
  organizations: OrganizationApiContract;
  /** The credential service the API doors already authenticate through. */
  apiKeys: ApiKeyApiContract;
  /** The share ledger the trace group composed: one project, one sharing rule. */
  share: ShareApiContract;
  /** The topic tree the trace group composed. */
  topics: TopicApiContract;
  /** The deployment's cipher, for a project's object-storage credentials. */
  encryption: SecretEncryption | undefined;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtections | undefined;
}>;

import type { ComposedProjectFeature } from "./project.composition.types.ts";

/** Installs `project.*` over this process's own graph. */
export async function installApiProject(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: ProjectPeers;
}): Promise<ComposedProjectFeature> {
  const logger = createLogger("langwatch:api:project");
  const { peers } = options;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.infrastructure.prisma })
    .withInfrastructure({})
    .withProvided(OrganizationApi, peers.organizations)
    .withProvided(ApiKeyApi, peers.apiKeys)
    .withProvided(ShareApi, peers.share)
    .withProvided(TopicApi, peers.topics)
    .withModule(projectServer, {
      infrastructure: {
        // The scheduler lives on the worker: this process starts no clustering
        // run, and says so by name rather than reporting one it never queued.
        topicClustering: {
          requestClustering: () =>
            Promise.reject(
              new ApiProjectUnavailableError(
                "topic-clustering scheduler, so it cannot start a clustering run",
              ),
            ),
        },
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(projectServer).provided;

  return {
    app,
    router: (mount) => createProjectTrpcRouter(mount.runtime, projectPorts(options, logger)),
  };
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
