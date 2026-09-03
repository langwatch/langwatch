/**
 * Preparing a Studio graph before any version of it is written.
 *
 * Two steps, moved together from the platform app because they were always one
 * decision: editor-only local node configuration is folded into the execution
 * DSL (`runtime/app/features/workflow.ts`), and every LLM node arriving
 * without a model is filled in from the project's own cascade
 * (`server/workflows/materializeNodeLlmConfigs.ts`).
 *
 * The second is a PERSISTENCE chokepoint rather than a convenience: there is
 * no workflow-level default at execution time, so a graph written with a
 * modelless LLM node is a graph that fails at run time with nothing to point
 * at. Filling it in here is what guarantees no persisted DSL can do that.
 */
import {
  ModelNotConfiguredError,
  getLatestOpenAIChatFlagship,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import {
  mergeLocalConfigsIntoDsl,
  type LLMConfig,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { WorkflowStudioDslPort } from "../ports/workflow.port";

/**
 * The terminal fallback model, the registry flagship.
 *
 * The same value the platform app's `DEFAULT_MODEL` resolved to, derived from
 * the same registry call rather than copied as a literal: seeding model
 * defaults must never be a precondition for creating a runnable workflow, and
 * a fresh install with zero configuration still gets the newest plain OpenAI
 * chat flagship.
 */
const REGISTRY_FLAGSHIP_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

type LlmParameterLike = { identifier?: string; type?: string; value?: unknown };
type NodeLike = { data?: { parameters?: LlmParameterLike[] } };
type GraphLike = { default_llm?: LLMConfig | null; nodes?: NodeLike[] };

const hasModel = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LLMConfig).model === "string" &&
  (value as LLMConfig).model !== "";

/** Folds local node configuration in, then materialises every missing model. */
export class ModelProviderWorkflowStudioDslAdapter extends WorkflowStudioDslPort {
  static create(options: {
    modelProviders: ModelProviderService;
  }): ModelProviderWorkflowStudioDslAdapter {
    return new ModelProviderWorkflowStudioDslAdapter(options);
  }

  private constructor(private readonly options: { modelProviders: ModelProviderService }) {
    super();
  }

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
   * Fills every modelless LLM parameter, in this order:
   *
   *   1. the payload's legacy `default_llm` (old clients still send it) — the
   *      same folding the spec_version 1.5 migration applies on read;
   *   2. the project's cascade-resolved `workflows.create_default` model;
   *   3. the registry flagship.
   *
   * The legacy field is dropped afterwards. Mutates the graph in place and
   * touches the model providers only when there is a gap to fill.
   */
  private async materialiseNodeLlmConfigs(input: {
    projectId: string;
    dsl: StudioWorkflow;
  }): Promise<void> {
    const dsl = input.dsl as unknown as GraphLike;
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
        // flagship. An infrastructure failure must not silently pin a model.
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
