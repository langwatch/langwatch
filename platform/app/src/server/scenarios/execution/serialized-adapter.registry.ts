/**
 * Registry for serialized adapter factories.
 *
 * Uses the registry pattern for Open/Closed Principle (OCP) compliance:
 * - Open for extension: Add new adapters by registering a factory
 * - Closed for modification: No changes to createAdapter needed
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type { RunParameterValues } from "../parameters";
import {
  createSerializedVoiceAgentAdapter,
  SerializedCodeAgentAdapter,
  SerializedConnectedAgentAdapter,
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
  SerializedWorkflowAgentAdapter,
} from "./serialized-adapters";
import type { ExecuteSyncTransport } from "./serialized-adapters/execute-sync-transport";
import { childExecuteSyncTransport } from "./serialized-adapters/execute-sync-transport";
import type {
  CodeAgentData,
  ConnectedAgentData,
  ExecuteSyncRoute,
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  TargetAdapterData,
  VoiceAgentData,
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
  /** The values the run resolved, which every target reads as `params.NAME`. */
  parameters?: RunParameterValues;
  /** How a code or workflow target reaches nlpgo. Already resolved, because
   *  the caller knows whether it is the child or the control plane. */
  executeSyncTransport?: ExecuteSyncTransport;
}) => AgentAdapter;

/**
 * Registry mapping adapter types to their factory functions.
 * To add a new adapter type, simply register it here.
 */
export const SERIALIZED_ADAPTER_FACTORIES: Record<string, AdapterFactory> = {
  prompt: ({ data, modelParams, nlpServiceUrl, parameters }) => {
    if (!modelParams) {
      throw new Error("Prompt adapter requires modelParams");
    }
    return new SerializedPromptConfigAdapter({
      config: data as PromptConfigData,
      litellmParams: modelParams,
      nlpServiceUrl: nlpServiceUrl,
      parameters,
    });
  },
  http: ({ data, parameters }) =>
    new SerializedHttpAgentAdapter({
      config: data as HttpAgentData,
      parameters,
    }),
  code: ({ data, projectApiKey, parameters, executeSyncTransport }) => {
    // One guard, because a code turn needs both or it cannot run: the
    // project's platform key, which reaches the engine inside the DSL, and a
    // way to reach the engine at all. `createAdapter` derives the second from
    // the first, so neither arrives without the other.
    if (!projectApiKey || !executeSyncTransport) {
      throw new Error(
        "Code adapter requires projectApiKey and a transport to the engine",
      );
    }
    return new SerializedCodeAgentAdapter({
      config: data as CodeAgentData,
      transport: executeSyncTransport,
      projectApiKey,
      parameters,
    });
  },
  workflow: ({ data, projectApiKey, parameters, executeSyncTransport }) => {
    // See the code factory above: both or neither.
    if (!projectApiKey || !executeSyncTransport) {
      throw new Error(
        "Workflow adapter requires projectApiKey and a transport to the engine",
      );
    }
    return new SerializedWorkflowAgentAdapter({
      config: data as WorkflowAgentData,
      transport: executeSyncTransport,
      projectApiKey,
      parameters,
    });
  },
  // The voice adapter reads its transport, agent id and credential from the
  // pre-fetched data and dials the transport. A missing credential fails the
  // run with the transport's named message (no vendor name leaks here — the
  // registry owns it).
  voice: ({ data }) =>
    createSerializedVoiceAgentAdapter({ data: data as VoiceAgentData }),
  // The relay route authenticates the child with the project key, the same
  // credential the code and workflow adapters carry to the engine.
  connected: ({ data, projectApiKey, parameters }) => {
    if (!projectApiKey) {
      throw new Error("Connected adapter requires projectApiKey");
    }
    return new SerializedConnectedAgentAdapter({
      config: data as ConnectedAgentData,
      projectApiKey,
      parameters,
    });
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
  parameters,
  executeSyncRoute,
  executeSyncTransport,
}: {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
  parameters?: RunParameterValues;
  /**
   * The route the parent chose for `execute_sync`. Used by a caller running
   * in the scenario child, which builds its own HTTP transport from it.
   */
  executeSyncRoute?: ExecuteSyncRoute;
  /**
   * A transport the caller already has. A caller running inside the control
   * plane passes `inProcessExecuteSyncTransport`, which reaches nlpgo the way
   * the control plane always does rather than posting to the relay route the
   * control plane itself serves.
   */
  executeSyncTransport?: ExecuteSyncTransport;
}): AgentAdapter {
  const factory = SERIALIZED_ADAPTER_FACTORIES[adapterData.type];

  if (!factory) {
    throw new Error(`Unknown adapter type: ${adapterData.type}`);
  }

  return factory({
    data: adapterData,
    modelParams,
    nlpServiceUrl,
    projectApiKey,
    parameters,
    executeSyncTransport:
      executeSyncTransport ??
      (projectApiKey === undefined
        ? undefined
        : childExecuteSyncTransport({
            route: executeSyncRoute,
            nlpServiceUrl,
            projectApiKey,
          })),
  });
}
