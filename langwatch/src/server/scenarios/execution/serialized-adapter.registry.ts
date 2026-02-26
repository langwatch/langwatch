/**
 * Registry for serialized adapter factories.
 *
 * Uses the registry pattern for Open/Closed Principle (OCP) compliance:
 * - Open for extension: Add new adapters by registering a factory
 * - Closed for modification: No changes to createAdapter needed
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type {
  CodeAgentData,
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  TargetAdapterData,
} from "./types";
import {
  SerializedCodeAgentAdapter,
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "./serialized.adapters";

type AdapterFactory = (params: {
  data: TargetAdapterData;
  modelParams: LiteLLMParams;
  nlpServiceUrl: string;
  batchRunId?: string;
}) => AgentAdapter;

/**
 * Registry mapping adapter types to their factory functions.
 * To add a new adapter type, simply register it here.
 */
export const SERIALIZED_ADAPTER_FACTORIES: Record<string, AdapterFactory> = {
  prompt: ({ data, modelParams, nlpServiceUrl }) =>
    new SerializedPromptConfigAdapter(
      data as PromptConfigData,
      modelParams,
      nlpServiceUrl,
    ),
  http: ({ data, batchRunId }) =>
    new SerializedHttpAgentAdapter({
      config: data as HttpAgentData,
      batchRunId,
    }),
  code: ({ data, modelParams, nlpServiceUrl }) =>
    new SerializedCodeAgentAdapter(
      data as CodeAgentData,
      nlpServiceUrl,
      modelParams.api_key,
    ),
};

/**
 * Creates an adapter from serialized data using the registry.
 *
 * @throws Error if adapter type is not registered
 */
export function createAdapter({
  adapterData,
  modelParams,
  nlpServiceUrl,
  batchRunId,
}: {
  adapterData: TargetAdapterData;
  modelParams: LiteLLMParams;
  nlpServiceUrl: string;
  batchRunId?: string;
}): AgentAdapter {
  const factory = SERIALIZED_ADAPTER_FACTORIES[adapterData.type];

  if (!factory) {
    throw new Error(`Unknown adapter type: ${adapterData.type}`);
  }

  return factory({ data: adapterData, modelParams, nlpServiceUrl, batchRunId });
}
