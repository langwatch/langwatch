/**
 * Prepares a Studio graph: folds editor-only config into DSL and fills modelless LLM nodes.
 */
import {
  ModelNotConfiguredError,
  findLatestOpenAIChatFlagship,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import {
  mergeLocalConfigsIntoDsl,
  type LLMConfig,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

import { type WorkflowStudioDsl } from "../app/workflow.app.ts";

/**
 * Terminal fallback model (registry flagship); derived from registry call, not hardcoded.
 */
const REGISTRY_FLAGSHIP_MODEL = findLatestOpenAIChatFlagship()[0] ?? "openai/gpt-5";

type LlmParameterLike = { identifier?: string; type?: string; value?: unknown };
type NodeLike = { data?: { parameters?: LlmParameterLike[] } };
type GraphLike = { default_llm?: LLMConfig | null; nodes?: NodeLike[] };

const hasModel = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LLMConfig).model === "string" &&
  (value as LLMConfig).model !== "";

/** Folds local node configuration in, then materialises every missing model. */
export class ModelProviderWorkflowStudioDslService implements WorkflowStudioDsl {
  static create(options: {
    modelProviders: ModelProviderApi;
  }): ModelProviderWorkflowStudioDslService {
    return new ModelProviderWorkflowStudioDslService(options);
  }

  private constructor(private readonly options: { modelProviders: ModelProviderApi }) {}

  async prepare(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    // The cast is the platform app's and stays: the Studio schema types nodes
    // loosely because the DSL node types are too polymorphic for one Zod
    // discriminated union, while `mergeLocalConfigsIntoDsl` works on the
    // narrowed node union.
    const prepared = {
      ...input.dsl,
      nodes: mergeLocalConfigsIntoDsl(input.dsl.nodes as never) as StudioWorkflow["nodes"],
      state: {},
    } as StudioWorkflow;

    await this.materialiseNodeLlmConfigs({ projectId: input.projectId, dsl: prepared });
    return prepared;
  }

  /**
   * Fills modelless LLM parameters from legacy default, project cascade, or registry flagship.
   */
  private async materialiseNodeLlmConfigs(input: {
    projectId: string;
    dsl: StudioWorkflow;
  }): Promise<void> {
    const dsl: GraphLike = input.dsl;
    const legacyDefault =
      dsl.default_llm && hasModel(dsl.default_llm) ? dsl.default_llm : undefined;
    delete dsl.default_llm;

    const modellessParameters = (dsl.nodes ?? [])
      .flatMap((node) => node.data?.parameters ?? [])
      .filter((parameter) => parameter.type === "llm" && !hasModel(parameter.value));
    if (modellessParameters.length === 0) return;

    let fallback: LLMConfig | undefined = legacyDefault;
    if (!fallback) {
      let resolvedModel: string | undefined;
      try {
        const resolved = await this.options.modelProviders.resolveModelForFeature({
          projectId: input.projectId,
          featureKey: "workflows.create_default",
        });
        resolvedModel = resolved.model;
      } catch (error) {
        // Only "nothing configured at any scope" falls back to the registry
        // flagship. An members failure must not silently pin a model.
        if (!(error instanceof ModelNotConfiguredError)) throw error;
      }
      fallback = { model: resolvedModel ?? REGISTRY_FLAGSHIP_MODEL };
    }

    for (const parameter of modellessParameters) {
      const value = (parameter.value ?? {}) as Partial<LLMConfig>;
      parameter.value = { ...fallback, ...value, model: fallback.model };
    }
  }
}
