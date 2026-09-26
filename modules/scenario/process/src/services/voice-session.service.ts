/** "Talk to it": gate, authorize and run main's voice-session handlers (voice-agents-v1). */
import type { AgentApi } from "@langwatch/agent-contract";
import { type AuthzApi, ProjectPermissionDeniedError } from "@langwatch/authz-contract";
import { type FeatureFlagApi, VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type {
  VoiceRecordingStream,
  VoiceSessionAudioRequest,
  VoiceSessionFinishRequest,
  VoiceSessionFinishResult,
  VoiceSessionInfrastructure,
  VoiceSessionMintRequest,
  VoiceSessionMintResult,
  VoiceSessionTokenPayload,
  SimulationService,
} from "@langwatch/scenario-contract";
import {
  authorizeRecordingPlayback,
  createVoiceTransportRegistry,
  voiceCallMaxSeconds,
  finishVoiceSession,
  mintVoiceSession,
  VoiceAgentsGateDisabledError,
  VoiceSessionInvalidError,
} from "@langwatch/scenario-contract/voice-runtime";

import type { VoiceRecordingChannel } from "../channels/voice-recording.channel.ts";
import { voicePermissionsFor } from "../rules/voice-permissions.rules.ts";
import type { ScenarioService } from "./scenario.service.ts";
import { createVoiceCallTraceRecorder } from "./voice-call-trace-writer.ts";
import { createVoiceCallRunWriter } from "./voice-run-writer.ts";
import { signVoiceSessionToken, verifyVoiceSessionToken } from "./voice-session-token.ts";
import { createVoiceSessionInfrastructureFromServices } from "./voice-session.infrastructure.ts";

type VoicePermission = "scenarios:create" | "scenarios:view" | "evaluations:manage";

/** Main signed with CREDENTIALS_SECRET, else NEXTAUTH_SECRET; neither leaves every call refused. */
function getSigningSecret(secret: string | undefined): string {
  if (!secret) throw new Error("Voice sessions need CREDENTIALS_SECRET or NEXTAUTH_SECRET");
  return secret;
}

type VoiceSessionOptions = {
  infrastructure: VoiceSessionInfrastructure;
  authz: Pick<AuthzApi, "hasPermission">;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  recordings: VoiceRecordingChannel;
  verifyToken: (input: { token: string; now: number }) => VoiceSessionTokenPayload;
  maxDurationSeconds: number;
};

export class VoiceSessionService {
  static create(options: VoiceSessionOptions): VoiceSessionService {
    return new VoiceSessionService(options);
  }

  /** Composes the service from scenario's own services and its peers' operations. */
  static compose(input: {
    peers: {
      agents: AgentApi;
      authz: AuthzApi;
      featureFlags: FeatureFlagApi;
      gateway: GatewayApi;
      modelProviders: ModelProviderApi;
    };
    scenarios: ScenarioService;
    simulations: SimulationService;
    signingSecret: string | undefined;
    voicePublicBaseUrl: string | undefined;
    voiceCallMaxSeconds: string | undefined;
    recordings: VoiceRecordingChannel;
  }): VoiceSessionService {
    const { peers, signingSecret } = input;
    const infrastructure = createVoiceSessionInfrastructureFromServices({
      agentService: {
        getById: (agent) => peers.agents.getById(agent),
        createVoiceAgent: (agent) => peers.agents.createVoiceAgent(agent),
        hasVoiceAgentForExternalId: (agent) => peers.agents.hasVoiceAgentForExternalId(agent),
      },
      scenarioService: { getById: (scenario) => input.scenarios.getById(scenario) },
      elevenLabsCredentials: {
        async resolveForProject({ projectId }) {
          const rows = await peers.modelProviders.findAllAccessibleForProject({ projectId });
          const row = rows.find((r) => r.provider === "elevenlabs" && r.enabled);
          if (!row?.id) return null;
          try {
            return await peers.gateway.getElevenLabsApiCredential({ modelProviderId: row.id });
          } catch (error) {
            if (HandledError.isHandled(error) && error.code === "voice_key_missing") return null;
            throw error;
          }
        },
      },
      simulations: input.simulations,
      recordCallTraces: createVoiceCallTraceRecorder({
        traces: {
          // TraceApi has no raw-span write yet (handoff voice-panel §11); the recorder swallows.
          recordSpan: () => Promise.reject(new Error("TraceApi has no recordSpan operation")),
        },
      }),
      writeCallRun: createVoiceCallRunWriter({
        agents: {
          findById: async (agent) => ((await peers.agents.exists(agent)) ? { id: agent.id } : null),
        },
        simulations: input.simulations,
      }),
      signSessionToken: (payload) =>
        signVoiceSessionToken({ payload, secret: getSigningSecret(signingSecret) }),
      registry: createVoiceTransportRegistry({ voicePublicBaseUrl: input.voicePublicBaseUrl }),
    });

    return VoiceSessionService.create({
      infrastructure,
      authz: peers.authz,
      featureFlags: peers.featureFlags,
      recordings: input.recordings,
      verifyToken: ({ token, now }) =>
        verifyVoiceSessionToken({ token, now, secret: getSigningSecret(signingSecret) }),
      maxDurationSeconds: voiceCallMaxSeconds({
        VOICE_CALL_MAX_SECONDS: input.voiceCallMaxSeconds,
      }),
    });
  }

  private constructor(private readonly options: VoiceSessionOptions) {}

  async mint(input: VoiceSessionMintRequest): Promise<VoiceSessionMintResult> {
    await this.#assertEnabled(input.projectId);
    await this.#requirePermissions({
      userId: input.userId,
      projectId: input.projectId,
      permissions: voicePermissionsFor({ createsAgent: !input.agentRowId }),
    });

    return mintVoiceSession({
      ports: this.options.infrastructure,
      projectId: input.projectId,
      transport: input.transport,
      agentId: input.agentId,
      ...(input.agentRowId ? { agentRowId: input.agentRowId } : {}),
      maxDurationSeconds: this.options.maxDurationSeconds,
    });
  }

  /** The token is verified before the permission probe, which it sizes (#8021 AC2). */
  async finish(input: VoiceSessionFinishRequest): Promise<VoiceSessionFinishResult> {
    await this.#assertEnabled(input.projectId);
    const token = this.options.verifyToken({
      token: input.sessionToken,
      now: this.options.infrastructure.now(),
    });
    if (token.projectId !== input.projectId) throw new VoiceSessionInvalidError();
    await this.#requirePermissions({
      userId: input.userId,
      projectId: input.projectId,
      permissions: voicePermissionsFor({ createsAgent: !token.agentId }),
    });

    return finishVoiceSession({
      ports: this.options.infrastructure,
      token,
      projectId: input.projectId,
      transcript: input.transcript,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      isCutAtLimit: input.isCutAtLimit,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
    });
  }

  async streamSessionAudio(input: VoiceSessionAudioRequest): Promise<VoiceRecordingStream> {
    await this.#assertEnabled(input.projectId);
    await this.#requirePermissions({
      userId: input.userId,
      projectId: input.projectId,
      permissions: ["scenarios:view"],
    });
    const credential = await authorizeRecordingPlayback({
      ports: this.options.infrastructure,
      projectId: input.projectId,
      conversationId: input.conversationId,
    });
    const mediaType = "audio/mpeg" as const;
    const stream = await this.options.recordings.open({
      url: `${credential.baseUrl}/v1/convai/conversations/${encodeURIComponent(input.conversationId)}/audio`,
      headers: { "xi-api-key": credential.apiKey },
      mediaType,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return { stream, mediaType };
  }

  /** A project without the flag reads as if the door did not exist (AC29). */
  async #assertEnabled(projectId: string): Promise<void> {
    const enabled = await this.options.featureFlags.isEnabled(VOICE_AGENTS_FLAG_KEY, {
      kind: "project",
      projectId,
    });
    if (!enabled) throw new VoiceAgentsGateDisabledError();
  }

  async #requirePermissions(input: {
    userId: string;
    projectId: string;
    permissions: readonly VoicePermission[];
  }): Promise<void> {
    for (const permission of input.permissions) {
      const allowed = await this.options.authz.hasPermission({
        userId: input.userId,
        permission,
        projectId: input.projectId,
      });
      if (!allowed) throw new ProjectPermissionDeniedError(permission);
    }
  }
}
