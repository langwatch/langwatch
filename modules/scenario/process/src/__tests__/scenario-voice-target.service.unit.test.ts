import { AgentNotFoundError, type AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { GatewayVoiceKeyMissingError, type GatewayApi } from "@langwatch/gateway-contract";
import type {
  ModelProviderApi,
  ModelProviderExecution,
  ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import { ScenarioTargetNotFoundError, type VoiceAgentConfig } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { ScenarioVoiceTargetService } from "../services/scenario-voice-target.service.ts";

const agentRecord = {
  id: "agent_voice",
  name: "Support line",
  projectId: "proj_1",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  environment: null,
  ownerUserId: null,
  hostLabel: null,
  lastSeenAt: null,
  parameters: [],
  owner: null,
  status: "offline" as const,
  instances: [],
  selectable: true,
  notSelectableReason: null,
  platformUrl: "https://app.example.com/agents/test",
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

type AgentRow = Awaited<ReturnType<AgentApi["getById"]>>;

const voiceAgent = (config: VoiceAgentConfig): AgentRow => ({
  ...agentRecord,
  type: "voice",
  config,
});

const httpAgent: AgentRow = {
  ...agentRecord,
  id: "agent_http",
  type: "http",
  config: { url: "https://api.example.com/chat", method: "POST", headers: [] },
};

const baseProvider = {
  createdAt: new Date(0),
  updatedAt: new Date(0),
  organizationId: "org_1",
  name: "provider",
  routingHandle: null,
  scopes: [],
  customModels: [],
  customEmbeddingsModels: [],
  extraHeaders: [],
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  fallbackPriorityGlobal: null,
  providerConfig: null,
  isSystem: false,
  embeddingsUnsupported: false,
};

function summary({
  id,
  provider,
  enabled,
}: {
  id: string;
  provider: string;
  enabled: boolean;
}): ModelProviderSummary {
  return { ...baseProvider, id, provider, enabled, customKeys: null };
}

function execution({
  enabled,
  customKeys,
}: {
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
}): ModelProviderExecution {
  return {
    ...baseProvider,
    id: "prov_openai",
    provider: "openai",
    enabled,
    customKeys,
    models: null,
    embeddingsModels: null,
  };
}

function harness({
  agent,
  providers = [],
  openai,
  voiceCallMaxSeconds,
}: {
  agent: AgentRow | "missing";
  providers?: ModelProviderSummary[];
  openai?: ModelProviderExecution;
  voiceCallMaxSeconds?: string;
}) {
  const credentialReads: string[] = [];
  const executionProviders: Record<string, ModelProviderExecution> = openai ? { openai } : {};
  const service = ScenarioVoiceTargetService.create({
    agents: createApiFixture<AgentApi>({
      getById: async () => {
        if (agent === "missing") throw new AgentNotFoundError("agent_voice");
        return agent;
      },
    }),
    modelProviders: createApiFixture<ModelProviderApi>({
      findAllAccessibleForProject: async () => providers,
      getExecutionProviders: async () => executionProviders,
    }),
    gateway: createApiFixture<GatewayApi>({
      getElevenLabsApiCredential: async ({ modelProviderId }) => {
        credentialReads.push(modelProviderId);
        return { apiKey: "xi-key", baseUrl: "https://api.elevenlabs.io" };
      },
      getTwilioCredential: async ({ modelProviderId }) => {
        credentialReads.push(modelProviderId);
        throw new GatewayVoiceKeyMissingError();
      },
    }),
    voiceCallMaxSeconds,
  });
  return { service, credentialReads };
}

const elevenLabsAgent = voiceAgent({ transport: "elevenlabs_convai", agentId: "el_agent" });
const target = { projectId: "proj_1", agentId: "agent_voice" };

describe("ScenarioVoiceTargetService", () => {
  describe("given the project has an enabled ElevenLabs provider", () => {
    /** @scenario "A voice target resolves its ElevenLabs credential from the project provider" */
    it("carries the resolved credential on the voice target", async () => {
      const { service } = harness({
        agent: elevenLabsAgent,
        providers: [summary({ id: "prov_1", provider: "elevenlabs", enabled: true })],
      });

      expect(await service.getVoiceTarget(target)).toMatchObject({
        type: "voice",
        agentId: "agent_voice",
        voiceTarget: {
          transport: "elevenlabs_convai",
          agentId: "el_agent",
          credential: { kind: "elevenlabs", apiKey: "xi-key" },
        },
      });
    });
  });

  describe("given the project has no ElevenLabs provider", () => {
    /** @scenario "A voice target with no ElevenLabs provider resolves a null credential" */
    it("carries a null credential and reads nothing", async () => {
      const { service, credentialReads } = harness({ agent: elevenLabsAgent });

      expect(await service.getVoiceTarget(target)).toMatchObject({
        voiceTarget: { credential: null },
      });
      expect(credentialReads).toEqual([]);
    });
  });

  describe("given a phone target whose Twilio row holds no key", () => {
    it("carries a null credential", async () => {
      const { service } = harness({
        agent: voiceAgent({
          transport: "phone",
          phoneNumber: "+14155559999",
          callDirection: "outbound",
        }),
        providers: [summary({ id: "prov_tw", provider: "twilio", enabled: true })],
      });

      expect(await service.getVoiceTarget(target)).toMatchObject({
        voiceTarget: { transport: "phone", credential: null, callDirection: "outbound" },
      });
    });
  });

  describe("given the project has an enabled OpenAI provider", () => {
    /** @scenario "A voice target carries the caller OpenAI key to the child" */
    it("carries the project's OpenAI key as caller env", async () => {
      const { service } = harness({
        agent: elevenLabsAgent,
        openai: execution({ enabled: true, customKeys: { OPENAI_API_KEY: "sk-openai" } }),
      });

      expect(await service.getVoiceTarget(target)).toMatchObject({
        callerEnv: { OPENAI_API_KEY: "sk-openai" },
      });
    });
  });

  describe("given no OpenAI provider", () => {
    it("carries an empty caller env", async () => {
      const { service } = harness({ agent: elevenLabsAgent });

      expect(await service.getVoiceTarget(target)).toMatchObject({ callerEnv: {} });
    });
  });

  describe("given a configured call cap", () => {
    it("carries it as the run's max call seconds", async () => {
      const { service } = harness({ agent: elevenLabsAgent, voiceCallMaxSeconds: "90" });

      expect(await service.getVoiceTarget(target)).toMatchObject({ maxCallSeconds: 90 });
    });
  });

  describe("given an agent that is missing or not a voice agent", () => {
    it.each([
      ["missing", "missing" as const],
      ["not a voice agent", httpAgent],
    ])("refuses a target that is %s by name", async (_label, agent) => {
      await expect(harness({ agent }).service.getVoiceTarget(target)).rejects.toBeInstanceOf(
        ScenarioTargetNotFoundError,
      );
    });
  });
});
