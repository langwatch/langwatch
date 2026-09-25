/**
 * Registry for serialized adapter factories. Uses the registry pattern for Open/Closed Principle
 * (OCP) compliance: - Open for extension: Add new adapters by registering a factory - Closed for
 * modification: No changes to `build` needed
 */

import { createLogger } from "@langwatch/observability";

import { type AgentAdapterFactory, type AgentAdapterBuildInput } from "../app/scenario.app.ts";
import { HttpSerializedCodeAgentChannel } from "./http/http.serialized-code-agent.channel.ts";
import { HttpSerializedConnectedAgentChannel } from "./http/http.serialized-connected-agent.channel.ts";
import { HttpSerializedHttpAgentChannel } from "./http/http.serialized-http-agent.channel.ts";
import { HttpSerializedPromptConfigChannel } from "./http/http.serialized-prompt-config.channel.ts";
import { HttpSerializedWorkflowAgentChannel } from "./http/http.serialized-workflow-agent.channel.ts";
import type { NlpFetchTimeouts } from "./nlp-fetch.channel.ts";
import type { SerializedAgentChannel } from "./serialized-agent.channel.ts";

/**
 * Creates an adapter from serialized data using the registry. @throws Error if adapter type is not
 * registered, or if the resolved factory is missing the credential it needs (modelParams for
 * prompt, projectApiKey for workflow/code).
 */
export class SerializedAgentChannelRegistry implements AgentAdapterFactory {
  /**
   * `nlpTimeouts` are the operator's nlpgo deadlines, read by the process that
   * composed this registry — an unset one falls back to the same default the
   * adapters have always applied.
   */
  static create({
    nlpTimeouts,
  }: { nlpTimeouts?: NlpFetchTimeouts } = {}): SerializedAgentChannelRegistry {
    return new SerializedAgentChannelRegistry(nlpTimeouts ?? {});
  }

  private constructor(private readonly nlpTimeouts: NlpFetchTimeouts) {}

  build(input: AgentAdapterBuildInput): SerializedAgentChannel {
    const { adapterData } = input;
    switch (adapterData.type) {
      case "prompt": {
        if (!input.modelParams) {
          throw new Error("Prompt adapter requires modelParams");
        }
        return HttpSerializedPromptConfigChannel.create({
          config: adapterData,
          litellmParams: input.modelParams,
          nlpServiceUrl: input.nlpServiceUrl,
          parameters: input.parameters,
          logger: input.logger,
        });
      }
      case "http":
        return HttpSerializedHttpAgentChannel.create({
          config: adapterData,
          parameters: input.parameters,
          httpPort: input.httpPort,
          logger: input.logger,
        });
      case "code": {
        if (!input.projectApiKey) {
          throw new Error("Code adapter requires projectApiKey");
        }
        return HttpSerializedCodeAgentChannel.create({
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
        return HttpSerializedWorkflowAgentChannel.create({
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
        return HttpSerializedConnectedAgentChannel.create({
          config: adapterData,
          projectApiKey: input.projectApiKey,
          parameters: input.parameters,
          logger: input.logger ?? createLogger("langwatch:scenarios:connected-adapter"),
        });
      }
      case "voice":
        // No serialized voice adapter exists yet; see voice-agent.adapter.ts.
        throw new Error("Voice adapter is not yet implemented");
    }
  }
}
