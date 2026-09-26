/** "Talk to it": gate, authorize and run main's voice-session handlers (voice-agents-v1). */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { type AuthzApi, ProjectPermissionDeniedError } from "@langwatch/authz-contract";
import { type FeatureFlagApi, VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type {
  VoiceRecordingStream,
  VoiceRunAudioRequest,
  VoiceRunRecordingStream,
  VoiceSessionAudioRequest,
  VoiceSessionFinishRequest,
  VoiceSessionFinishResult,
  VoiceSessionInfrastructure,
  VoiceSessionMintRequest,
  VoiceSessionMintResult,
  VoiceSessionTokenPayload,
  SimulationService,
  WholeCallAudioInfrastructure,
} from "@langwatch/scenario-contract";
import {
  authorizeRecordingPlayback,
  createVoiceTransportRegistry,
  voiceCallMaxSeconds,
  finishVoiceSession,
  getWholeCallAudio,
  mintVoiceSession,
  twilioBasicAuthHeader,
  VoiceAgentsGateDisabledError,
  VoiceRecordingKeyMissingError,
  VoiceSessionInvalidError,
} from "@langwatch/scenario-contract/voice-runtime";
import type { TraceApi } from "@langwatch/trace-contract";

import type { VoiceRecordingChannel } from "../channels/voice-recording.channel.ts";
import { voicePermissionsFor } from "../rules/voice-permissions.rules.ts";
import type { ScenarioService } from "./scenario.service.ts";
import { createVoiceCallTraceRecorder } from "./voice-call-trace-writer.ts";
import { createVoiceCallRunWriter } from "./voice-run-writer.ts";
import { signVoiceSessionToken, verifyVoiceSessionToken } from "./voice-session-token.ts";
import { createVoiceSessionInfrastructureFromServices } from "./voice-session.infrastructure.ts";
import { createWholeCallAudioInfrastructure } from "./whole-call-audio.infrastructure.ts";

const logger = createLogger("langwatch:voice:session-service");

function asRecordingKeyMissing(error: unknown): never {
  if (HandledError.isHandled(error) && error.code === "voice_key_missing") {
    throw new VoiceRecordingKeyMissingError();
  }
  throw error;
}

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
  wholeCallAudio: WholeCallAudioInfrastructure;
  auditLog: Pick<AuditLogApi, "record">;
  twilioCredentials: {
    getForProject(input: { projectId: string }): Promise<{ accountSid: string; authToken: string }>;
  };
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
      auditLog: AuditLogApi;
      authz: AuthzApi;
      featureFlags: FeatureFlagApi;
      gateway: GatewayApi;
      modelProviders: ModelProviderApi;
      traces: TraceApi;
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
        traces: { recordSpan: (span) => peers.traces.recordSpan(span) },
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
      wholeCallAudio: createWholeCallAudioInfrastructure({
        simulations: input.simulations,
        traces: peers.traces,
      }),
      auditLog: peers.auditLog,
      twilioCredentials: {
        async getForProject({ projectId }) {
          const rows = await peers.modelProviders.findAllAccessibleForProject({ projectId });
          const row = rows.find((r) => r.provider === "twilio" && r.enabled);
          if (!row?.id) throw new VoiceRecordingKeyMissingError();
          return peers.gateway
            .getTwilioCredential({ modelProviderId: row.id })
            .catch(asRecordingKeyMissing);
        },
      },
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
    return this.#relay({
      url: `${credential.baseUrl}/v1/convai/conversations/${encodeURIComponent(input.conversationId)}/audio`,
      headers: { "xi-api-key": credential.apiKey },
      mediaType: "audio/mpeg",
      signal: input.signal,
    });
  }

  /** Main's run-audio door: the handle comes from the run's own spans, the authorization. */
  async streamRunAudio(input: VoiceRunAudioRequest): Promise<VoiceRunRecordingStream> {
    await this.#assertEnabled(input.projectId);
    await this.#requirePermissions({
      userId: input.userId,
      projectId: input.projectId,
      permissions: ["scenarios:view"],
    });
    const handle = await getWholeCallAudio({
      projectId: input.projectId,
      scenarioRunId: input.scenarioRunId,
      infrastructure: this.options.wholeCallAudio,
    });
    this.#auditRecordingAccess({ ...input, transport: handle.kind });

    if (handle.kind === "elevenlabs") {
      const credential = await this.options.infrastructure
        .getCredential({ projectId: input.projectId, transport: "elevenlabs_convai" })
        .catch(asRecordingKeyMissing);
      if (credential.kind !== "elevenlabs") throw new VoiceRecordingKeyMissingError();
      return this.#relay({
        url: `${credential.baseUrl}/v1/convai/conversations/${encodeURIComponent(handle.conversationId)}/audio`,
        headers: { "xi-api-key": credential.apiKey },
        mediaType: "audio/mpeg",
        signal: input.signal,
      });
    }

    const credential = await this.options.twilioCredentials.getForProject(input);
    const url = await this.options.recordings.getTwilioRecordingWavUrl({
      credential,
      callSid: handle.callSid,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return this.#relay({
      url,
      headers: { authorization: twilioBasicAuthHeader(credential) },
      mediaType: "audio/wav",
      signal: input.signal,
    });
  }

  async #relay<M extends VoiceRunRecordingStream["mediaType"]>(input: {
    url: string;
    headers: Record<string, string>;
    mediaType: M;
    signal: AbortSignal | undefined;
  }): Promise<{ stream: ReadableStream<Uint8Array>; mediaType: M }> {
    const stream = await this.options.recordings.open({
      url: input.url,
      headers: input.headers,
      mediaType: input.mediaType,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return { stream, mediaType: input.mediaType };
  }

  /** Recording access is PII: audited once authorized, fire-and-forget as main did. */
  #auditRecordingAccess(input: {
    userId: string;
    projectId: string;
    scenarioRunId: string;
    transport: string;
  }): void {
    void this.options.auditLog
      .record({
        action: "voice.recording.accessed",
        userId: input.userId,
        projectId: input.projectId,
        args: { scenarioRunId: input.scenarioRunId, transport: input.transport },
      })
      .catch((err: unknown) =>
        logger.error({ err, projectId: input.projectId }, "Failed to audit recording access"),
      );
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
