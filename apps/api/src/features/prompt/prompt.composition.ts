/**
 * A project's prompt library, composed as its own feature.
 *
 * `prompts.*` reads and writes the stored prompts and their versions, and
 * publishes the `ctx.app.prompts` slice the packaged prompt REST family and the
 * hosted MCP surface read.
 *
 * The model gateway is optional here on purpose: a prompt row reads and writes
 * without it, and the adapter's own contract treats an absent gateway as "no
 * provider metadata" rather than a failure. So the namespace mounts on a
 * deployment with no gateway; what it cannot do there is annotate a version
 * with the provider behind its model.
 */
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import { PostgresPromptAdapter, PromptApp, type PromptTrpcPorts } from "@langwatch/prompt-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createPromptTrpcRouter } from "./prompt-trpc.mount";

/**
 * The product signal a project's new prompt fires, for a deployment that has
 * one. Fire and forget: it may never fail a create.
 */
export abstract class ApiPromptNurturingPort {
  abstract afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
}

/** The other feature's service the prompt surface reaches. */
export type PromptPeers = Readonly<{
  /** The project directory a stored prompt's scope is resolved through. */
  projects: ProjectService;
  /** The model gateway a stored prompt's model reference is resolved against. */
  modelProviders?: ModelProviderService;
}>;

/** The namespace and the `ctx.app.prompts` slice two other doors read. */
export type ComposedPromptFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPromptTrpcRouter>;
  /** For `ctx.app.prompts`. */
  app: PromptApp;
}>;

/** Composes the prompt library over this process's own graph. */
export function composePromptFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: PromptPeers;
  /** The nurturing sink, where the deployment composed one. */
  nurturing?: ApiPromptNurturingPort;
}): ComposedPromptFeature {
  const logger = createLogger("langwatch:api:prompt");

  return {
    router: (mount) =>
      createPromptTrpcRouter({ ...mount, ports: promptPorts(logger, options.nurturing) }),
    app: PromptApp.create({
      prompts: PostgresPromptAdapter.create({
        database: options.infrastructure.prisma,
        ...(options.peers.modelProviders ? { modelProvider: options.peers.modelProviders } : {}),
      }).build(),
      projects: options.peers.projects,
    }),
  };
}

/**
 * The prompt library on a process that composed no graph to read it over.
 *
 * The namespace still mounts and every call refuses by name, so a project is
 * told its prompts are unreachable rather than shown an empty library.
 */
export function refusingPromptFeature(): ComposedPromptFeature {
  const logger = createLogger("langwatch:api:prompt");
  const refuse = (): never => {
    throw new ApiPromptUnavailableError();
  };

  return {
    router: (mount) =>
      createPromptTrpcRouter({ ...mount, ports: promptPorts(logger, undefined) }),
    app: new Proxy({}, { get: () => refuse, has: () => true }) as PromptApp,
  };
}

/**
 * The one answer the prompt surface needs from the deployment.
 *
 * The same on a composed feature and a refusing one: the signal is
 * fire-and-forget marketing, so an absent sink logs once rather than refusing
 * the prompt it was meant to announce.
 */
function promptPorts(
  logger: Pick<Logger, "debug">,
  nurturing: ApiPromptNurturingPort | undefined,
): PromptTrpcPorts {
  return {
    afterPromptCreated: (input) => {
      if (!nurturing) {
        logger.debug(
          { projectId: input.projectId },
          "no prompt nurturing sink is composed: the lifecycle signal for this prompt is not sent",
        );
        return;
      }
      nurturing.afterPromptCreated(input);
    },
  };
}

/** The prompt library reached on a process that composed none. */
class ApiPromptUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "The prompt library is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiPromptUnavailableError";
  }
}
