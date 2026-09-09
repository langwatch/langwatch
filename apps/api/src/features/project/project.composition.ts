/**
 * `project.*` — one project's lifecycle and its settings form — composed as its own
 * feature.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  declareAuthzMiddleware,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { ProjectApp } from "@langwatch/project-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { ApiAuditPort } from "../../api-request.policy.ts";

import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiViewerProtectionsPort } from "../trace/trace-viewer-protections.ts";

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

  // The namespace, its ports and its two data-dependent checks went with the
  // transport that took them; they return with the converted one.
  return { app };
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

  return { app: new Proxy({}, { get: () => refuse, has: () => true }) as ProjectApi };
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
