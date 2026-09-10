/**
 * Registry for serialized adapter factories. Uses the registry pattern for Open/Closed Principle
 * (OCP) compliance: - Open for extension: Add new adapters by registering a factory - Closed for
 * modification: No changes to `build` needed
 */

import type { AgentAdapter } from "@langwatch/scenario";
import { AgentAdapterFactory, type AgentAdapterBuildInput } from "../app/scenario.app.ts";
import type { NlpFetchTimeouts } from "./nlp-fetch.adapter.ts";
import { SerializedCodeAgentAdapter } from "./serialized-code-agent.adapter.ts";
import { SerializedHttpAgentAdapter } from "./serialized-http-agent.adapter.ts";
import { SerializedPromptConfigAdapter } from "./serialized-prompt-config.adapter.ts";
import { SerializedConnectedAgentAdapter } from "./serialized-connected-agent.adapter.ts";
import { SerializedWorkflowAgentAdapter } from "./serialized-workflow-agent.adapter.ts";

/**
 * Creates an adapter from serialized data using the registry. @throws Error if adapter type is not
 * registered, or if the resolved factory is missing the credential it needs (modelParams for
 * prompt, projectApiKey for workflow/code).
 */
export class SerializedAgentRegistryAdapter implements AgentAdapterFactory {
  /**
   * `nlpTimeouts` are the operator's nlpgo deadlines, read by the process that
   * composed this registry — an unset one falls back to the same default the
   * adapters have always applied.
   */
  static create({
    nlpTimeouts,
  }: { nlpTimeouts?: NlpFetchTimeouts } = {}): SerializedAgentRegistryAdapter {
    return new SerializedAgentRegistryAdapter(nlpTimeouts ?? {});
  }

  private constructor(private readonly nlpTimeouts: NlpFetchTimeouts) {
  }

  build(input: AgentAdapterBuildInput): AgentAdapter {
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
          timeouts: this.nlpTimeouts,
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
          timeouts: this.nlpTimeouts,
        });
      }
      case "connected": {
        if (!input.projectApiKey) {
          throw new Error("Connected adapter requires projectApiKey");
        }
        return SerializedConnectedAgentAdapter.create({
          config: adapterData,
          projectApiKey: input.projectApiKey,
          parameters: input.parameters,
          logger: input.logger,
        });
      }
    }
  }
}
