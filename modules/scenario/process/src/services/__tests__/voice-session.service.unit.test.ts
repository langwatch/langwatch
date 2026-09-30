/** @see specs voice-agents-v1.feature: the voice door's gate, permissions and recording relay. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryVoiceRecordingChannel } from "../../channels/memory/memory.voice-recording.channel.ts";
import { type VoiceTransportRunner } from "../../channels/voice-transport.channel.ts";
import type { VoiceSessionInfrastructure } from "../voice-call.service.ts";
import { VoiceSessionService } from "../voice-session.service.ts";
import type { WholeCallAudioInfrastructure } from "../whole-call-audio.service.ts";

const AUDIO_URL = "https://api.elevenlabs.io/v1/convai/conversations/conv_1/audio";
const TWILIO_WAV_URL = "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.wav";

function build(
  options: {
    enabled?: boolean;
    granted?: readonly string[];
    runSpans?: readonly Record<string, unknown>[];
    tokenProjectId?: string;
    tokenAgentId?: string | null;
  } = {},
) {
  const createVoiceAgent = vi.fn(async () => ({ id: "agent_new" }));
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
    getVoiceAgentRow: async () => ({ id: "row_1", agentExternalId: "vendor_agent" }),
    createVoiceAgent,
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
      projectId: options.tokenProjectId ?? "project_other",
      agentId: options.tokenAgentId === undefined ? null : options.tokenAgentId,
      agentExternalId: "vendor_agent",
      transport: "elevenlabs_convai" as const,
      exp: 2_000,
    })),
    maxDurationSeconds: 300,
  });

  return { service, asked, recordings, audited, createVoiceAgent };
}

const finish = {
  projectId: "project_1",
  sessionToken: "token",
  transcript: [],
  startedAt: 1,
  endedAt: 2,
  isCutAtLimit: false,
  userId: "user_1",
};

const mint = {
  projectId: "project_1",
  transport: "elevenlabs_convai" as const,
  agentId: "vendor_agent",
  userId: "user_1",
};

describe("VoiceSessionService", () => {
  describe("given a project without the voice agents flag", () => {
    /** @scenario "A mint request is refused with a 404 while the voice flag is off" */
    it("refuses as if the door did not exist", async () => {
      const { service } = build({ enabled: false });

      await expect(service.mint(mint)).rejects.toMatchObject({ code: "voice_agents_disabled" });
    });

    /** @scenario "A finish request is refused with a 404 while the voice flag is off" */
    it("refuses a finish the same way", async () => {
      const { service } = build({ enabled: false });

      await expect(service.finish(finish)).rejects.toMatchObject({
        code: "voice_agents_disabled",
        httpStatus: 404,
      });
    });

    /** @scenario "The audio proxy is refused with a 404 while the voice flag is off" */
    it("refuses the recording audio proxy the same way", async () => {
      const { service } = build({ enabled: false });

      await expect(
        service.streamSessionAudio({
          projectId: "project_1",
          conversationId: "conv_1",
          userId: "user_1",
        }),
      ).rejects.toMatchObject({ code: "voice_agents_disabled", httpStatus: 404 });
    });
  });

  describe("given a mint that will create an agent", () => {
    /** @scenario "Talk to it without agent-management rights and no saved row is refused" */
    it("asks for evaluations:manage on top of scenarios:create", async () => {
      const { service, asked } = build({ granted: ["scenarios:create"] });

      await expect(service.mint(mint)).rejects.toMatchObject({ code: "project_permission_denied" });
      expect(asked).toEqual(["scenarios:create", "evaluations:manage"]);
    });

    /** @scenario "Talk to it with agent-management rights mints an unsaved session" */
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

  describe("given a member with no permission on the requested project", () => {
    /** @scenario "A Talk to it request for another project is refused" */
    it("refuses as forbidden and signs no session", async () => {
      const { service, createVoiceAgent } = build({ granted: [] });

      await expect(service.mint(mint)).rejects.toMatchObject({ code: "project_permission_denied" });
      expect(createVoiceAgent).not.toHaveBeenCalled();
    });
  });

  describe("given a mint against a saved agent row", () => {
    /** @scenario "Talk to it against a saved agent needs only scenario rights" */
    it("asks for scenarios:create alone and mints", async () => {
      const { service, asked } = build({ granted: ["scenarios:create"] });

      await expect(service.mint({ ...mint, agentRowId: "row_1" })).resolves.toMatchObject({
        sessionToken: "signed:project_1",
      });
      expect(asked).toEqual(["scenarios:create"]);
    });
  });

  describe("given a finish of an unsaved session by a member without agent management", () => {
    /** @scenario "Finishing an unsaved session without agent-management rights is refused" */
    it("refuses for evaluations:manage and creates no agent", async () => {
      const { service, asked, createVoiceAgent } = build({
        granted: ["scenarios:create"],
        tokenProjectId: "project_1",
      });

      await expect(service.finish({ ...finish, name: "New agent" })).rejects.toMatchObject({
        code: "project_permission_denied",
      });
      expect(asked).toEqual(["scenarios:create", "evaluations:manage"]);
      expect(createVoiceAgent).not.toHaveBeenCalled();
    });
  });

  describe("given a finish of a saved session by a member without agent management", () => {
    /** @scenario "Talk to it against a saved agent needs only scenario rights" */
    it("asks for scenarios:create alone", async () => {
      const { service, asked } = build({
        granted: ["scenarios:create"],
        tokenProjectId: "project_1",
        tokenAgentId: "agent_1",
      });

      await Promise.allSettled([service.finish(finish)]);

      expect(asked).toEqual(["scenarios:create"]);
    });
  });

  describe("given a finish whose token names another project", () => {
    /** @scenario "A session minted for one project cannot finish a call in another project" */
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
