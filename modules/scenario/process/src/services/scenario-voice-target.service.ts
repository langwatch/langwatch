import { AgentNotFoundError, type Agent, type AgentApi } from "@langwatch/agent-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  parseVoiceAgentConfig,
  ScenarioTargetNotFoundError,
  voiceCallMaxSeconds,
  type VoiceAgentData,
} from "@langwatch/scenario-contract";

import {
  resolveVoiceTarget,
  type VoiceTransportCredentialReader,
} from "../rules/voice-target.rules.ts";
import type { VoiceTargetReader } from "./scenario-target-prefetch.service.ts";

type ScenarioVoiceTargetOptions = {
  agents: Pick<AgentApi, "getById">;
  modelProviders: Pick<ModelProviderApi, "findAllAccessibleForProject" | "getExecutionProviders">;
  gateway: Pick<GatewayApi, "getElevenLabsApiCredential" | "getTwilioCredential">;
  /** The deployment's VOICE_CALL_MAX_SECONDS: a run records the cap it started under. */
  voiceCallMaxSeconds: string | undefined;
};

/** A voice run's job data: the agent's transport credential, the caller's key and the call cap. */
export class ScenarioVoiceTargetService implements VoiceTargetReader {
  static create(options: ScenarioVoiceTargetOptions): ScenarioVoiceTargetService {
    return new ScenarioVoiceTargetService(options);
  }

  private constructor(private readonly options: ScenarioVoiceTargetOptions) {}

  async getVoiceTarget({
    projectId,
    agentId,
  }: {
    projectId: string;
    agentId: string;
  }): Promise<VoiceAgentData> {
    const agent = await this.#findAgent({ projectId, agentId });
    if (agent?.type !== "voice") {
      throw new ScenarioTargetNotFoundError({ targetType: "voice", referenceId: agentId });
    }

    return {
      type: "voice",
      agentId: agent.id,
      voiceTarget: await resolveVoiceTarget({
        projectId,
        config: parseVoiceAgentConfig(agent.config),
        credentials: this.#credentials,
      }),
      callerEnv: await this.#callerEnv(projectId),
      maxCallSeconds: voiceCallMaxSeconds({
        VOICE_CALL_MAX_SECONDS: this.options.voiceCallMaxSeconds,
      }),
    };
  }

  async #findAgent({
    projectId,
    agentId,
  }: {
    projectId: string;
    agentId: string;
  }): Promise<Agent | null> {
    try {
      return await this.options.agents.getById({ projectId, id: agentId });
    } catch (error) {
      if (error instanceof AgentNotFoundError) return null;
      throw error;
    }
  }

  #credentials: VoiceTransportCredentialReader = {
    findElevenLabs: (projectId) =>
      this.#readCredential({
        projectId,
        provider: "elevenlabs",
        read: (modelProviderId) =>
          this.options.gateway.getElevenLabsApiCredential({ modelProviderId }),
      }),
    findTwilio: (projectId) =>
      this.#readCredential({
        projectId,
        provider: "twilio",
        read: (modelProviderId) => this.options.gateway.getTwilioCredential({ modelProviderId }),
      }),
  };

  /** Null when the project has no enabled row for the provider, or the row holds no key. */
  async #readCredential<Credential>({
    projectId,
    provider,
    read,
  }: {
    projectId: string;
    provider: string;
    read: (modelProviderId: string) => Promise<Credential>;
  }): Promise<Credential | null> {
    const rows = await this.options.modelProviders.findAllAccessibleForProject({ projectId });
    const row = rows.find((candidate) => candidate.provider === provider && candidate.enabled);
    if (!row?.id) return null;
    try {
      return await read(row.id);
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "voice_key_missing") return null;
      throw error;
    }
  }

  /** The SDK's TTS and transcription read the project's OpenAI key; nothing else goes. */
  async #callerEnv(projectId: string): Promise<Record<string, string>> {
    const { openai } = await this.options.modelProviders.getExecutionProviders({ projectId });
    const apiKey = openai?.enabled ? openai.customKeys?.OPENAI_API_KEY : undefined;
    return typeof apiKey === "string" && apiKey ? { OPENAI_API_KEY: apiKey } : {};
  }
}
