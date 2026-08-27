import {
  customModelEntrySchema,
  type CustomModelEntry,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { z } from "zod";
import {
  filterUnsupportedSamplingParams,
  resolveSupportedParameters,
} from "@langwatch/model-provider-contract";

const llmLikeSchema = z.object({ model: z.string().optional() }).catchall(z.unknown());
type LLMLike = z.infer<typeof llmLikeSchema>;

type CustomModelsByProvider = Record<string, CustomModelEntry[] | null>;

/**
 * Resolve the project's customModels (one map keyed by provider key) so
 * the workflow-walk filter can look up `supportedParameters` per node
 * without an extra DB hop per model occurrence.
 */
async function loadProjectCustomModels(
  modelProviders: ModelProviderService,
  projectId: string,
): Promise<CustomModelsByProvider> {
  const providers = await modelProviders.getExecutionProviders({ projectId });
  const map: CustomModelsByProvider = {};
  for (const [providerKey, provider] of Object.entries(providers)) {
    map[providerKey] = provider.customModels.map((model) =>
      customModelEntrySchema.parse({
        modelId: model.id,
        displayName: model.label,
        mode: "chat",
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        ...(model.supportedParameters === undefined
          ? {}
          : { supportedParameters: model.supportedParameters }),
        ...(model.multimodalInputs === undefined
          ? {}
          : { multimodalInputs: model.multimodalInputs }),
      }),
    );
  }
  return map;
}

/**
 * Strip every sampling parameter from `llm` that the resolved model
 * doesn't list as supported. Identifies the provider from the model
 * string (`provider/modelId`) and consults the project's customModels
 * via `resolveSupportedParameters`.
 *
 * Bug #4429: stale prompt-config blobs persisted a `top_p` even after
 * the operator removed it from the custom model's supportedParameters
 * list. Switching to a different model and back did not clear it. This
 * filter runs at the dispatch chokepoint so the stale value never
 * leaves the control plane.
 */
function filterLLMNode(
  llm: LLMLike,
  customModelsByProvider: CustomModelsByProvider,
): LLMLike {
  if (!llm.model) return llm;
  const provider = llm.model.split("/")[0];
  if (!provider) return llm;
  const customModels = customModelsByProvider[provider] ?? null;
  const allowed = resolveSupportedParameters(llm.model, {
    customModels,
  });
  return filterUnsupportedSamplingParams(llm, allowed);
}

/**
 * Walk a workflow DSL payload and strip unsupported sampling params on
 * every place an LLMConfig lives:
 *   - node.data.llm (top-level on signature components)
 *   - node.data.parameters[].value (when identifier === "llm")
 *
 * This is the single backend chokepoint that catches every studio
 * dispatch path (execute_component, execute_flow, execute_evaluation)
 * before the workflow hits nlpgo / langwatch_nlp. Mutates `workflow`
 * in place — the caller passes the message it is about to forward.
 */
export async function stripUnsupportedLLMParamsFromWorkflow(
  modelProviders: ModelProviderService,
  opts: {
    projectId: string;
    workflow: {
      nodes?: Array<{
        data?: {
          llm?: LLMLike;
          parameters?: Array<{
            identifier?: string;
            value?: unknown;
          }>;
        };
      }>;
    };
  },
): Promise<void> {
  const customModelsByProvider = await loadProjectCustomModels(
    modelProviders,
    opts.projectId,
  );
  const { workflow } = opts;
  for (const node of workflow.nodes ?? []) {
    const data = node.data;
    if (!data) continue;
    if (data.llm && typeof data.llm === "object" && !Array.isArray(data.llm)) {
      const llm = llmLikeSchema.parse(data.llm);
      data.llm = filterLLMNode(llm, customModelsByProvider);
    }
    for (const param of data.parameters ?? []) {
      if (
        param.identifier === "llm" &&
        param.value &&
        typeof param.value === "object" &&
        !Array.isArray(param.value)
      ) {
        const value = llmLikeSchema.parse(param.value);
        param.value = filterLLMNode(value, customModelsByProvider);
      }
    }
  }
}
