/**
 * The model handle a Langy conversation's title call runs on. `@langwatch/langy-server` owns the
 * prompt, the character budget and the transcript; it declares {@link LangyTitleModelPort} for the
 * one thing it does not own, which is WHICH model a project's title call reaches.
 */
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { ModelProviderExecutionHandleService } from "@langwatch/model-provider-server";
import { LangyTitleModelPort } from "@langwatch/langy-server";
import { HttpWorkflowNlpRuntimeAdapter } from "@langwatch/workflow-server";

/**
 * The project read the model cascade needs. Declared structurally rather than as `ProjectService`,
 * because what the cascade uses is these two reads and nothing else — and this process composes the
 * READ half of Project only.
 */
export type WorkerLangyTitleProjectDirectory = {
  tryGetWithTeam: Parameters<
    typeof ModelProviderExecutionHandleService.getVercelAIModel
  >[0]["projects"]["tryGetWithTeam"];
  getWithTeam: Parameters<
    typeof ModelProviderExecutionHandleService.getVercelAIModel
  >[0]["projects"]["getWithTeam"];
};

export type WorkerLangyTitleModelOptions = Readonly<{
  /** The gateway this process composed, when it composed one. */
  modelProviders: ModelProviderService | undefined;
  /** The project directory the cascade derives a scope chain from. */
  projects: WorkerLangyTitleProjectDirectory | undefined;
  /** The NLP engine's address, as the deployment named it. */
  nlpServiceUrl: string | undefined;
}>;

/**
 * Composes the port, or nothing where a precondition is missing.
 */
export function tryCreateWorkerLangyTitleModel(
  options: WorkerLangyTitleModelOptions,
): LangyTitleModelPort | undefined {
  const { modelProviders, projects, nlpServiceUrl } = options;
  if (!modelProviders || !projects || !nlpServiceUrl) return undefined;
  return WorkerLangyTitleModelAdapter.create({
    modelProviders,
    projects,
    // The engine's address plus the proxy path, joined here because the path
    // is the WORKFLOW feature's and the address is the deployment's — the same
    // join `apps/api` makes for its authoring surfaces.
    executionProxyBaseUrl: HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl({ baseUrl: nlpServiceUrl }),
  });
}

/** The cascade, then the named fallback, over one gateway instance. */
class WorkerLangyTitleModelAdapter extends LangyTitleModelPort {
  static create(options: {
    modelProviders: ModelProviderService;
    projects: WorkerLangyTitleProjectDirectory;
    executionProxyBaseUrl: string;
  }): WorkerLangyTitleModelAdapter {
    return new WorkerLangyTitleModelAdapter(options);
  }

  private constructor(
    private readonly options: {
      modelProviders: ModelProviderService;
      projects: WorkerLangyTitleProjectDirectory;
      executionProxyBaseUrl: string;
    },
  ) {
    super();
  }

  async resolveTitleModel(input: {
    projectId: string;
    featureKey: string;
    fallbackModel: string;
  }): Promise<Awaited<ReturnType<typeof ModelProviderExecutionHandleService.getVercelAIModel>>> {
    try {
      return await ModelProviderExecutionHandleService.getVercelAIModel({
        ...this.options,
        projectId: input.projectId,
        featureKey: input.featureKey,
      });
    } catch (error) {
      // ONLY this error means the cascade resolved nothing. Everything else —
      // a disabled provider, an unknown project — propagates, because falling
      // back through one of those would run a customer's title call on a
      // provider they had switched off.
      if (!(error instanceof ModelNotConfiguredError)) throw error;
      return await ModelProviderExecutionHandleService.getVercelAIModel({
        ...this.options,
        projectId: input.projectId,
        model: input.fallbackModel,
      });
    }
  }
}
