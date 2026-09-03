/**
 * The model handle a Langy conversation's title call runs on.
 *
 * `@langwatch/langy-server` owns the prompt, the character budget and the
 * transcript; it declares {@link LangyTitleModelPort} for the one thing it does
 * not own, which is WHICH model a project's title call reaches. This composes
 * that port over this process's own model gateway.
 *
 * ## The two-step resolution lives here
 *
 * A project may point `langy.conversation_title` at a model of its own, and
 * most projects point it nowhere. `getVercelAIModel` answers the second case
 * with `ModelNotConfiguredError`, and only that error means "the cascade
 * resolved nothing" — a disabled provider, an unknown project or an
 * unreachable proxy are different failures that must NOT be answered by
 * quietly running the call on a model nobody chose. Distinguishing them needs
 * the model-provider contract's own error type, which is why the fallback is
 * the adapter's and not the feature package's.
 *
 * ## Three preconditions, and each is a refusal rather than a default
 *
 * The gateway decrypts the project's stored credential, the project directory
 * says which team and organization a project belongs to, and the execution
 * proxy is where an OpenAI-compatible request is actually sent. A composition
 * missing any of the three cannot make the call at all, so it composes NO port
 * and the conversation keeps whatever title it has — reported by name at boot
 * through the langy absence report, never as a title call that silently
 * disappears.
 */
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { getVercelAIModel } from "@langwatch/model-provider-server";
import { LangyTitleModelPort } from "@langwatch/langy-server";
import { nlpProxyBaseUrl } from "@langwatch/workflow-server";

/**
 * The project read the model cascade needs.
 *
 * Declared structurally rather than as `ProjectService`, because what the
 * cascade uses is these two reads and nothing else — and this process composes
 * the READ half of Project only. Naming the full service would have made this
 * composable only where the write half exists, which is not what the model
 * call needs.
 */
export type WorkerLangyTitleProjectDirectory = {
  tryGetWithTeam: Parameters<typeof getVercelAIModel>[0]["projects"]["tryGetWithTeam"];
  getWithTeam: Parameters<typeof getVercelAIModel>[0]["projects"]["getWithTeam"];
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
 *
 * `undefined` rather than a port that throws, because the caller's absence
 * report is what a deployment reads: a port that rejected every call would
 * turn one boot-time fact into one warning per conversation, all of them
 * saying the same thing.
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
    executionProxyBaseUrl: nlpProxyBaseUrl({ baseUrl: nlpServiceUrl }),
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
  }): Promise<Awaited<ReturnType<typeof getVercelAIModel>>> {
    try {
      return await getVercelAIModel({
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
      return await getVercelAIModel({
        ...this.options,
        projectId: input.projectId,
        model: input.fallbackModel,
      });
    }
  }
}
