/** @see specs voice-agents-v1.feature: the voice door's gate, permissions and recording relay. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  ScenarioRunStatus,
  type VoiceSessionInfrastructure,
  type WholeCallAudioInfrastructure,
} from "@langwatch/scenario-contract";
import type { VoiceTransportRunner } from "@langwatch/scenario-contract/voice-runtime";
import { describe, expect, it, vi } from "vitest";

import { MemoryVoiceRecordingChannel } from "../../channels/memory/memory.voice-recording.channel.ts";
import { VoiceSessionService } from "../voice-session.service.ts";

const AUDIO_URL = "https://api.elevenlabs.io/v1/convai/conversations/conv_1/audio";
const TWILIO_WAV_URL = "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.wav";

function build(
  options: {
    enabled?: boolean;
    granted?: readonly string[];
    runSpans?: readonly Record<string, unknown>[];
  } = {},
) {
  const asked: string[] = [];
  const audited: RecordAuditLogCommand[] = [];
  const runner = createApiFixture<VoiceTransportRunner>({
    assertAvailable: () => {},
    mintSession: async () => ({ signedUrl: "wss://signed" }),
  });
  const infrastructure = createApiFixture<VoiceSessionInfrastructure>({
    getCredential: async () => ({
      kind: "elevenlabs",
      apiKey: "xi-key",
      baseUrl: "https://api.elevenlabs.io",
    }),
    findExistingRun: async () => ({
      status: ScenarioRunStatus.SUCCESS,
      agentId: "agent_1",
      source: "provider",
      audioUrl: null,
      scenarioId: "scenario_1",
      scenarioSetId: "set_1",
    }),
    signSessionToken: (payload) => `signed:${payload.projectId}`,
    now: () => 1_000,
    newSessionId: () => "session_1",
    registry: { elevenlabs_convai: runner, phone: runner },
  });
  const recordings = MemoryVoiceRecordingChannel.create(
    { [AUDIO_URL]: new Uint8Array([7]), [TWILIO_WAV_URL]: new Uint8Array([9]) },
    { CA1: TWILIO_WAV_URL },
  );
  const service = VoiceSessionService.create({
    infrastructure,
    authz: createApiFixture<AuthzApi>({
      hasPermission: async ({ permission }) => {
        asked.push(permission);
        return (
          options.granted ?? ["scenarios:create", "scenarios:view", "evaluations:manage"]
        ).includes(permission);
      },
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async () => options.enabled ?? true,
    }),
    recordings,
    wholeCallAudio: createApiFixture<WholeCallAudioInfrastructure>({
      loadRunTraceIds: async () => ["trace_1"],
      readSpanAttributes: async () => options.runSpans ?? [],
    }),
    auditLog: createApiFixture<AuditLogApi>({
      record: async (command) => {
        audited.push(command);
        return { id: "audit_1", occurredAt: 0 };
      },
    }),
    twilioCredentials: {
      getForProject: async () => ({ accountSid: "AC1", authToken: "twilio-token" }),
    },
    verifyToken: vi.fn(() => ({
      sessionId: "session_1",
      projectId: "project_other",
      agentId: null,
      agentExternalId: "vendor_agent",
      transport: "elevenlabs_convai" as const,
      exp: 2_000,
    })),
    maxDurationSeconds: 300,
  });

  return { service, asked, recordings, audited };
}

const mint = {
  projectId: "project_1",
  transport: "elevenlabs_convai" as const,
  agentId: "vendor_agent",
  userId: "user_1",
};

describe("VoiceSessionService", () => {
  describe("given a project without the voice agents flag", () => {
    it("refuses as if the door did not exist", async () => {
      const { service } = build({ enabled: false });

      await expect(service.mint(mint)).rejects.toMatchObject({ code: "voice_agents_disabled" });
    });
  });

  describe("given a mint that will create an agent", () => {
    it("asks for evaluations:manage on top of scenarios:create", async () => {
      const { service, asked } = build({ granted: ["scenarios:create"] });

      await expect(service.mint(mint)).rejects.toMatchObject({ code: "project_permission_denied" });
      expect(asked).toEqual(["scenarios:create", "evaluations:manage"]);
    });

    it("signs a session bound to the project when both are granted", async () => {
      const { service } = build();

      await expect(service.mint(mint)).resolves.toEqual({
        transport: "elevenlabs_convai",
        sessionToken: "signed:project_1",
        maxDurationSeconds: 300,
        connect: { signedUrl: "wss://signed" },
      });
    });
  });

  describe("given a finish whose token names another project", () => {
    it("refuses with voice_session_invalid before any permission probe", async () => {
      const { service, asked } = build();

      await expect(
        service.finish({
          projectId: "project_1",
          sessionToken: "token",
          transcript: [],
          startedAt: 1,
          endedAt: 2,
          isCutAtLimit: false,
          userId: "user_1",
        }),
      ).rejects.toMatchObject({ code: "voice_session_invalid" });
      expect(asked).toEqual([]);
    });
  });

  describe("given a recording of a scenario run", () => {
    it("streams it from the provider with the key kept server-side", async () => {
      const { service, recordings } = build();

      const recording = await service.streamSessionAudio({
        projectId: "project_1",
        conversationId: "conv_1",
        userId: "user_1",
      });

      expect(recording.mediaType).toBe("audio/mpeg");
      expect([...new Uint8Array(await new Response(recording.stream).arrayBuffer())]).toEqual([7]);
      expect(recordings.opened).toEqual([{ url: AUDIO_URL, headers: { "xi-api-key": "xi-key" } }]);
    });
  });

  describe("given a headless phone run whose span names a Twilio call", () => {
    it("streams the .wav with Twilio basic auth and audits the access", async () => {
      const { service, recordings, audited } = build({
        runSpans: [{}, { "voice.twilio.call_sid": "CA1" }],
      });

      const recording = await service.streamRunAudio({
        projectId: "project_1",
        scenarioRunId: "scenariorun_1",
        userId: "user_1",
      });

      expect(recording.mediaType).toBe("audio/wav");
      expect([...new Uint8Array(await new Response(recording.stream).arrayBuffer())]).toEqual([9]);
      expect(recordings.opened).toEqual([
        {
          url: TWILIO_WAV_URL,
          headers: { authorization: `Basic ${btoa("AC1:twilio-token")}` },
        },
      ]);
      expect(audited).toEqual([
        {
          action: "voice.recording.accessed",
          userId: "user_1",
          projectId: "project_1",
          args: { scenarioRunId: "scenariorun_1", transport: "twilio" },
        },
      ]);
    });
  });

  describe("given a headless run whose span names an ElevenLabs conversation", () => {
    it("streams the conversation audio with the project's ElevenLabs key", async () => {
      const { service, recordings } = build({
        runSpans: [{ "voice.elevenlabs.conversation_id": "conv_1" }],
      });

      const recording = await service.streamRunAudio({
        projectId: "project_1",
        scenarioRunId: "scenariorun_1",
        userId: "user_1",
      });

      expect(recording.mediaType).toBe("audio/mpeg");
      expect(recordings.opened).toEqual([{ url: AUDIO_URL, headers: { "xi-api-key": "xi-key" } }]);
    });
  });

  describe("given a run whose spans name no call", () => {
    it("refuses with voice_recording_unavailable and audits nothing", async () => {
      const { service, audited } = build({ runSpans: [{}] });

      await expect(
        service.streamRunAudio({
          projectId: "project_1",
          scenarioRunId: "scenariorun_1",
          userId: "user_1",
        }),
      ).rejects.toMatchObject({ code: "voice_recording_unavailable" });
      expect(audited).toEqual([]);
    });
  });
});
