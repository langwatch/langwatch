/**
 * Registry for serialized adapter factories.
 *
 * Uses the registry pattern for Open/Closed Principle (OCP) compliance:
 * - Open for extension: Add new adapters by registering a factory
 * - Closed for modification: No changes to createAdapter needed
 */

import type { AgentAdapter } from "@langwatch/scenario";
import {
  SerializedCodeAgentAdapter,
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
  SerializedWorkflowAgentAdapter,
} from "./serialized-adapters";
import type {
  CodeAgentData,
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  TargetAdapterData,
  WorkflowAgentData,
} from "./types";

type AdapterFactory = (params: {
  data: TargetAdapterData;
  /** The prompt's own inference credentials. Only the prompt factory reads
   *  this — workflow/code use `projectApiKey` instead, and http needs
   *  neither (issue #6634). */
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  /** The LangWatch platform API key (project.apiKey). Only the workflow and
   *  code factories read this — see their adapters' doc comments for why it
   *  is the platform key, never an LLM credential. */
  projectApiKey?: string;
}) => AgentAdapter;

/**
 * Registry mapping adapter types to their factory functions.
 * To add a new adapter type, simply register it here.
 */
export const SERIALIZED_ADAPTER_FACTORIES: Record<string, AdapterFactory> = {
  prompt: ({ data, modelParams, nlpServiceUrl }) => {
    if (!modelParams) {
      throw new Error("Prompt adapter requires modelParams");
    }
    return new SerializedPromptConfigAdapter(
      data as PromptConfigData,
      modelParams,
      nlpServiceUrl,
    );
  },
  http: ({ data }) => new SerializedHttpAgentAdapter(data as HttpAgentData),
  code: ({ data, nlpServiceUrl, projectApiKey }) => {
    if (!projectApiKey) {
      throw new Error("Code adapter requires projectApiKey");
    }
    return new SerializedCodeAgentAdapter(
      data as CodeAgentData,
      nlpServiceUrl,
      projectApiKey,
    );
  },
  workflow: ({ data, nlpServiceUrl, projectApiKey }) => {
    if (!projectApiKey) {
      throw new Error("Workflow adapter requires projectApiKey");
    }
    return new SerializedWorkflowAgentAdapter(
      data as WorkflowAgentData,
      nlpServiceUrl,
      projectApiKey,
    );
  },
};

/**
 * Creates an adapter from serialized data using the registry.
 *
 * @throws Error if adapter type is not registered, or if the resolved
 *   factory is missing the credential it needs (modelParams for prompt,
 *   projectApiKey for workflow/code).
 */
export function createAdapter({
  adapterData,
  modelParams,
  nlpServiceUrl,
  projectApiKey,
}: {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
}): AgentAdapter {
  const factory = SERIALIZED_ADAPTER_FACTORIES[adapterData.type];

  if (!factory) {
    throw new Error(`Unknown adapter type: ${adapterData.type}`);
  }

  return factory({ data: adapterData, modelParams, nlpServiceUrl, projectApiKey });
}
