/**
 * Registry for serialized adapter factories. Uses the registry pattern for Open/Closed Principle
 * (OCP) compliance: - Open for extension: Add new adapters by registering a factory - Closed for
 * modification: No changes to `build` needed
 */

import { createLogger, type Logger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import type {
  LiteLLMParams,
  RunParameterValues,
  TargetAdapterData,
  VoiceAgentData,
} from "@langwatch/scenario-contract";

import { HttpSerializedCodeAgentChannel } from "./http/http.serialized-code-agent.channel.ts";
import { HttpSerializedConnectedAgentChannel } from "./http/http.serialized-connected-agent.channel.ts";
import {
  HttpSerializedHttpAgentChannel,
  type ScenarioHttp,
} from "./http/http.serialized-http-agent.channel.ts";
import { HttpSerializedPromptConfigChannel } from "./http/http.serialized-prompt-config.channel.ts";
import { HttpSerializedWorkflowAgentChannel } from "./http/http.serialized-workflow-agent.channel.ts";
import type { NlpFetchTimeouts } from "./nlp-fetch.channel.ts";

/** The serialized description one agent adapter is built from. */
export type AgentAdapterBuildInput = {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
  parameters?: RunParameterValues;
  httpPort?: ScenarioHttp;
  logger?: Logger;
};

/**
 * Builds a voice target's adapter over the transports. The entrypoint supplies it, since the
 * transports still live with the live voice session in the scenario module.
 */
export type VoiceAgentBuilder = (data: VoiceAgentData) => AgentAdapter;

/** Ends a voice target's live call through its transport, so the drained transcript is judged. */
export type VoiceCallEnder = (input: {
  data: VoiceAgentData;
  adapter: AgentAdapter;
}) => Promise<void>;

/**
 * Creates an adapter from serialized data using the registry. @throws Error if adapter type is not
 * registered, or if the resolved factory is missing the credential it needs (modelParams for
 * prompt, projectApiKey for workflow/code).
 */
export class SerializedAgentChannelRegistry {
  /**
   * `nlpTimeouts` are the operator's nlpgo deadlines, read by the process that
   * composed this registry — an unset one falls back to the same default the
   * adapters have always applied.
   */
  static create({
    nlpTimeouts,
    voiceAgents,
  }: {
    nlpTimeouts?: NlpFetchTimeouts;
    voiceAgents: VoiceAgentBuilder;
  }): SerializedAgentChannelRegistry {
    return new SerializedAgentChannelRegistry(nlpTimeouts ?? {}, voiceAgents);
  }

  private constructor(
    private readonly nlpTimeouts: NlpFetchTimeouts,
    private readonly voiceAgents: VoiceAgentBuilder,
  ) {}

  build(input: AgentAdapterBuildInput): AgentAdapter {
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
        // The runner reads the transport, agent and credential off the prefetched data and
        // dials; a missing credential fails the run with the transport's own message.
        return this.voiceAgents(adapterData);
    }
  }
}
