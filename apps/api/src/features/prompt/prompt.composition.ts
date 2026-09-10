/**
 * A project's prompt library, composed as its own feature. `prompts.*` reads and writes
 * the stored prompts and their versions, and publishes the `ctx.app.prompts` slice the
 * packaged prompt REST family and the hosted MCP surface read.
 */
import type { Logger } from "@langwatch/observability";
import { createLogger } from "@langwatch/observability";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  PostgresPromptAdapter,
  promptServer,
  type PromptService,
} from "@langwatch/prompt-server";
import { createApp } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createPromptTrpcRouters } from "./prompt-trpc.mount.ts";
import { mountPromptsRest } from "./prompt-rest.mount.ts";
import type { ComposedPromptFeature } from "./prompt.composition.types.ts";

/**
 * The product signal a project's new prompt fires, for a deployment that has
 * one. Fire and forget: it may never fail a create.
 */
export abstract class ApiPromptNurturing {
  abstract afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
}

/** The other feature's service the prompt surface reaches. */
export type PromptPeers = Readonly<{
  /** The project directory a stored prompt's scope is resolved through. */
  projects: ProjectApiContract;
  /** The authorization service a tag-catalogue write's cascade is checked against. */
  permissions: AuthzApi;
  /** The model gateway a stored prompt's model reference is resolved against. */
  modelProviders?: ModelProviderApi;
  /** The nurturing sink, where the deployment composed one. */
  nurturing?: ApiPromptNurturing;
}>;

/** Installs `prompts.*`, `promptTags.*` and `/api/prompts` over this process's own graph. */
export async function installApiPrompt(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: PromptPeers;
}): Promise<ComposedPromptFeature> {
  const logger = createLogger("langwatch:api:prompt");
  const { peers } = options;

  // The four repositories behind this engine have not moved onto
  // `defineRepositories` yet (ADR-133's persistence half); until they do, the
  // installer still builds the composite engine from `PostgresPromptAdapter`
  // and hands it down as infrastructure. See `PromptInfrastructure.prompts`.
  const prompts: PromptService = PostgresPromptAdapter.create({
    database: options.infrastructure.prisma,
    ...(peers.modelProviders ? { modelProvider: peers.modelProviders } : {}),
  }).build();

  const runtime = await createApp({ name: "langwatch-api" })
    .withInfrastructure({})
    .withProvided(ProjectApi, peers.projects)
    .withProvided(AuthzApi, peers.permissions)
    .withModule(promptServer, {
      infrastructure: {
        prompts,
        afterPromptCreated: (input) =>
          (peers.nurturing ?? LoggedApiPromptNurturing.create(logger)).afterPromptCreated(input),
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(promptServer).provided;

  return {
    app,
    routers: (mount) => createPromptTrpcRouters(mount.runtime),
    rest: (restRuntime) => mountPromptsRest(restRuntime, { prompts: () => app }),
  };
}

/**
 * The nurturing trail a first prompt leaves, for a deployment that composed no
 * product-analytics sink. Logged rather than refused: it is a marketing
 * signal, and refusing it would cost somebody the prompt they just wrote.
 */
class LoggedApiPromptNurturing extends ApiPromptNurturing {
  static create(logger: Logger): LoggedApiPromptNurturing {
    return new LoggedApiPromptNurturing(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  afterPromptCreated(input: { projectId: string; userId?: string | null }): void {
    this.logger.info(
      { projectId: input.projectId, userId: input.userId ?? null },
      "prompt created; no product-analytics sink is composed on this process",
    );
  }
}
