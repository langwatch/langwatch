/**
 * The child's runtime table: each target type declares its input schema, factory, resource
 * class and stop signal in one row. A new runtime is a new row; `build` does not change.
 */

import { createLogger, type Logger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import {
  CodeAgentDataSchema,
  ConnectedAgentDataSchema,
  HttpAgentDataSchema,
  type LiteLLMParams,
  PromptConfigDataSchema,
  type RunParameterValues,
  type ScenarioResourceClass,
  type ScenarioStopSignal,
  TARGET_RESOURCE_CLASS,
  TARGET_STOP_SIGNAL,
  type TargetAdapterData,
  VoiceAgentDataSchema,
  type VoiceAgentData,
  WorkflowAgentDataSchema,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

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

/** What a runtime factory is given besides its own parsed data. */
type RuntimeContext = {
  input: AgentAdapterBuildInput;
  nlpTimeouts: NlpFetchTimeouts;
  voiceAgents: VoiceAgentBuilder;
};

type RuntimeRow = {
  resourceClass: ScenarioResourceClass;
  stopSignal: ScenarioStopSignal;
  build: (context: RuntimeContext) => AgentAdapter;
};

/** Binds a row's schema to its factory so the factory gets its own target's data, parsed. */
function runtime<Data extends TargetAdapterData>({
  schema,
  resourceClass,
  stopSignal,
  factory,
}: {
  schema: z.ZodType<Data>;
  resourceClass: ScenarioResourceClass;
  stopSignal: ScenarioStopSignal;
  factory: (args: { data: Data } & RuntimeContext) => AgentAdapter;
}): RuntimeRow {
  return {
    resourceClass,
    stopSignal,
    build: (context) => factory({ data: schema.parse(context.input.adapterData), ...context }),
  };
}

export const SERIALIZED_AGENT_RUNTIMES = {
  prompt: runtime({
    schema: PromptConfigDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.prompt,
    stopSignal: TARGET_STOP_SIGNAL.prompt,
    factory: ({ data, input }) => {
      if (!input.modelParams) {
        throw new Error("Prompt adapter requires modelParams");
      }
      return HttpSerializedPromptConfigChannel.create({
        config: data,
        litellmParams: input.modelParams,
        nlpServiceUrl: input.nlpServiceUrl,
        parameters: input.parameters,
        logger: input.logger,
      });
    },
  }),
  http: runtime({
    schema: HttpAgentDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.http,
    stopSignal: TARGET_STOP_SIGNAL.http,
    factory: ({ data, input }) =>
      HttpSerializedHttpAgentChannel.create({
        config: data,
        parameters: input.parameters,
        httpPort: input.httpPort,
        logger: input.logger,
      }),
  }),
  code: runtime({
    schema: CodeAgentDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.code,
    stopSignal: TARGET_STOP_SIGNAL.code,
    factory: ({ data, input, nlpTimeouts }) => {
      if (!input.projectApiKey) {
        throw new Error("Code adapter requires projectApiKey");
      }
      return HttpSerializedCodeAgentChannel.create({
        config: data,
        nlpServiceUrl: input.nlpServiceUrl,
        projectApiKey: input.projectApiKey,
        parameters: input.parameters,
        timeouts: nlpTimeouts,
      });
    },
  }),
  workflow: runtime({
    schema: WorkflowAgentDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.workflow,
    stopSignal: TARGET_STOP_SIGNAL.workflow,
    factory: ({ data, input, nlpTimeouts }) => {
      if (!input.projectApiKey) {
        throw new Error("Workflow adapter requires projectApiKey");
      }
      return HttpSerializedWorkflowAgentChannel.create({
        config: data,
        nlpServiceUrl: input.nlpServiceUrl,
        projectApiKey: input.projectApiKey,
        parameters: input.parameters,
        timeouts: nlpTimeouts,
      });
    },
  }),
  connected: runtime({
    schema: ConnectedAgentDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.connected,
    stopSignal: TARGET_STOP_SIGNAL.connected,
    factory: ({ data, input }) => {
      if (!input.projectApiKey) {
        throw new Error("Connected adapter requires projectApiKey");
      }
      return HttpSerializedConnectedAgentChannel.create({
        config: data,
        projectApiKey: input.projectApiKey,
        parameters: input.parameters,
        logger: input.logger ?? createLogger("langwatch:scenarios:connected-adapter"),
      });
    },
  }),
  voice: runtime({
    schema: VoiceAgentDataSchema,
    resourceClass: TARGET_RESOURCE_CLASS.voice,
    stopSignal: TARGET_STOP_SIGNAL.voice,
    // The runner reads the transport, agent and credential off the prefetched data and dials; a
    // missing credential fails the run with the transport's own message.
    factory: ({ data, voiceAgents }) => voiceAgents(data),
  }),
} as const satisfies Record<TargetAdapterData["type"], RuntimeRow>;

/**
 * Creates an adapter from serialized data through the runtime table. @throws Error if the resolved
 * factory is missing the credential it needs (modelParams for prompt, projectApiKey for
 * workflow/code/connected).
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
    return SERIALIZED_AGENT_RUNTIMES[input.adapterData.type].build({
      input,
      nlpTimeouts: this.nlpTimeouts,
      voiceAgents: this.voiceAgents,
    });
  }
}
