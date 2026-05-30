import type { PrismaClient } from "@prisma/client";

import { ModelProviderService } from "../modelProviders/modelProvider.service";
import {
  filterUnsupportedSamplingParams,
  resolveSupportedParameters,
} from "../modelProviders/resolveSupportedParameters";
import type { CustomModelEntry } from "../modelProviders/customModel.schema";

type LLMLike = {
  model?: string;
  [key: string]: unknown;
};

type CustomModelsByProvider = Record<string, CustomModelEntry[] | null>;

/**
 * Resolve the project's customModels (one map keyed by provider key) so
 * the workflow-walk filter can look up `supportedParameters` per node
 * without an extra DB hop per model occurrence.
 */
async function loadProjectCustomModels(
  prisma: PrismaClient,
  projectId: string,
): Promise<CustomModelsByProvider> {
  const service = ModelProviderService.create(prisma);
  const providers = await service.getProjectModelProviders(projectId);
  const map: CustomModelsByProvider = {};
  for (const [providerKey, provider] of Object.entries(providers)) {
    map[providerKey] = (provider.customModels ?? null) as
      | CustomModelEntry[]
      | null;
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
 *   - workflow.default_llm
 *   - node.data.llm (top-level on signature components)
 *   - node.data.parameters[].value (when identifier === "llm")
 *
 * This is the single backend chokepoint that catches every studio
 * dispatch path (execute_component, execute_flow, execute_evaluation)
 * before the workflow hits nlpgo / langwatch_nlp. Mutates `workflow`
 * in place — the caller passes the message it is about to forward.
 */
export async function stripUnsupportedLLMParamsFromWorkflow(opts: {
  prisma: PrismaClient;
  projectId: string;
  workflow: {
    default_llm?: LLMLike;
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
}): Promise<void> {
  const customModelsByProvider = await loadProjectCustomModels(
    opts.prisma,
    opts.projectId,
  );
  const { workflow } = opts;
  if (workflow.default_llm) {
    Object.assign(
      workflow.default_llm,
      filterLLMNode(workflow.default_llm, customModelsByProvider),
    );
    pruneRemovedKeys(workflow.default_llm, customModelsByProvider);
  }
  for (const node of workflow.nodes ?? []) {
    const data = node.data;
    if (!data) continue;
    if (data.llm && typeof data.llm === "object") {
      const filtered = filterLLMNode(data.llm, customModelsByProvider);
      replaceObjectContents(data.llm, filtered);
    }
    for (const param of data.parameters ?? []) {
      if (
        param.identifier === "llm" &&
        param.value &&
        typeof param.value === "object"
      ) {
        const value = param.value as LLMLike;
        const filtered = filterLLMNode(value, customModelsByProvider);
        replaceObjectContents(value, filtered);
      }
    }
  }
}

/**
 * Drop keys from `target` that the filter removed. Object.assign alone
 * keeps stale keys; we need explicit deletion so the serialized payload
 * matches the filter's output.
 */
function pruneRemovedKeys(
  target: LLMLike,
  customModelsByProvider: CustomModelsByProvider,
): void {
  const filtered = filterLLMNode(target, customModelsByProvider);
  for (const key of Object.keys(target)) {
    if (!(key in filtered)) {
      delete target[key];
    }
  }
}

function replaceObjectContents(target: LLMLike, source: LLMLike): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      delete target[key];
    }
  }
  Object.assign(target, source);
}
