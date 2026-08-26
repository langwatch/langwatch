/**
 * Registry for serialized adapter factories.
 *
 * Uses the registry pattern for Open/Closed Principle (OCP) compliance:
 * - Open for extension: Add new adapters by registering a factory
 * - Closed for modification: No changes to createAdapter needed
 */

import type { Logger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import type { RunParameterValues } from "@langwatch/scenario-contract";
import { SerializedCodeAgentAdapter } from "./serialized-code-agent.adapter";
import { SerializedHttpAgentAdapter } from "./serialized-http-agent.adapter";
import { SerializedPromptConfigAdapter } from "./serialized-prompt-config.adapter";
import { SerializedWorkflowAgentAdapter } from "./serialized-workflow-agent.adapter";
import type { LiteLLMParams, TargetAdapterData } from "@langwatch/scenario-contract";
import type { ScenarioHttpPort } from "../ports/scenario-http.port";

type CreateSerializedAdapterInput = {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
  parameters?: RunParameterValues;
  httpPort?: ScenarioHttpPort;
  logger?: Logger;
};

/**
 * Creates an adapter from serialized data using the registry.
 *
 * @throws Error if adapter type is not registered, or if the resolved
 *   factory is missing the credential it needs (modelParams for prompt,
 *   projectApiKey for workflow/code).
 */
export class SerializedAgentRegistryAdapter {
  static create(): SerializedAgentRegistryAdapter {
    return new SerializedAgentRegistryAdapter();
  }

  private constructor() {}

  static build(input: CreateSerializedAdapterInput): AgentAdapter {
    const { adapterData } = input;
    switch (adapterData.type) {
      case "prompt": {
        if (!input.modelParams) {
          throw new Error("Prompt adapter requires modelParams");
        }
        return SerializedPromptConfigAdapter.create({
          config: adapterData,
          litellmParams: input.modelParams,
          nlpServiceUrl: input.nlpServiceUrl,
          parameters: input.parameters,
          logger: input.logger,
        });
      }
      case "http":
        return SerializedHttpAgentAdapter.create({
          config: adapterData,
          parameters: input.parameters,
          httpPort: input.httpPort,
          logger: input.logger,
        });
      case "code": {
        if (!input.projectApiKey) {
          throw new Error("Code adapter requires projectApiKey");
        }
        return SerializedCodeAgentAdapter.create({
          config: adapterData,
          nlpServiceUrl: input.nlpServiceUrl,
          projectApiKey: input.projectApiKey,
          parameters: input.parameters,
        });
      }
      case "workflow": {
        if (!input.projectApiKey) {
          throw new Error("Workflow adapter requires projectApiKey");
        }
        return SerializedWorkflowAgentAdapter.create({
          config: adapterData,
          nlpServiceUrl: input.nlpServiceUrl,
          projectApiKey: input.projectApiKey,
          parameters: input.parameters,
        });
      }
    }
  }
}

export const createAdapter = SerializedAgentRegistryAdapter.build;
