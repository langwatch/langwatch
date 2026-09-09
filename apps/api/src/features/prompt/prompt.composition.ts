/**
 * A project's prompt library, composed as its own feature. `prompts.*` reads and writes
 * the stored prompts and their versions, and publishes the `ctx.app.prompts` slice the
 * packaged prompt REST family and the hosted MCP surface read.
 */
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { PostgresPromptAdapter, PromptApp } from "@langwatch/prompt-server";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

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
  projects: ProjectApi;
  /** The model gateway a stored prompt's model reference is resolved against. */
  modelProviders?: ModelProviderService;
}>;

import type { ComposedPromptFeature } from "./prompt.composition.types.ts";

/** Composes the prompt library over this process's own graph. */
export function composePromptFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: PromptPeers;
  /** The nurturing sink, where the deployment composed one. */
  nurturing?: ApiPromptNurturingPort;
}): ComposedPromptFeature {
  // The namespace and its one nurturing port went with the transport that took
  // them; they return with the converted one.
  return {
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
 * The prompt library on a process that composed no graph to read it over. The namespace
 * still mounts and every call refuses by name, so a project is told its prompts are
 * unreachable rather than shown an empty library.
 */
export function refusingPromptFeature(): ComposedPromptFeature {
  const refuse = (): never => {
    throw new ApiPromptUnavailableError();
  };

  return { app: new Proxy({}, { get: () => refuse, has: () => true }) as PromptApp };
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
