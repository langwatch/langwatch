/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { CallRecord } from "../call-record";
import {
  finishVoiceSession,
  mintVoiceSession,
  VoiceAgentRowNotFoundError,
  VoiceConversationMismatchError,
  VoiceKeyMissingError,
  type VoiceSessionPorts,
} from "../voice-session.service";
import type { VoiceSessionTokenPayload } from "../voice-session-token";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";

const CREDENTIAL: VoiceTransportCredential = {
  apiKey: "sk-secret-123",
  baseUrl: "https://api.elevenlabs.io",
};

function fakeRunner(
  over: Partial<VoiceTransportRunner> = {},
): VoiceTransportRunner {
  return {
    missingKeyMessage: "No ElevenLabs key in this project",
    createAgentAdapter: () => ({}) as never,
    mintSession: vi.fn(async () => ({ signedUrl: "wss://signed.example/abc" })),
    fetchCallRecord: vi.fn(async () => null),
    endCall: vi.fn(async () => {}),
    ...over,
  };
}

function fakePorts(
  runner: VoiceTransportRunner,
  over: Partial<VoiceSessionPorts> = {},
): VoiceSessionPorts {
  return {
    resolveCredential: vi.fn(async () => CREDENTIAL),
    resolveVoiceAgentRow: vi.fn(async () => ({
      id: "agent_row",
      agentExternalId: "agent_xyz",
    })),
    findExistingRun: vi.fn(async () => null),
    createVoiceAgent: vi.fn(async () => ({ id: "agent_created" })),
    writeCallRun: vi.fn(async () => {}),
    audioProxyUrl: ({ conversationId, projectId }) =>
      `/api/voice/session/${conversationId}/audio?projectId=${projectId}`,
    // A fake signer that round-trips the payload so tests can read the claims.
    signSessionToken: (payload) => JSON.stringify(payload),
    now: () => 1000,
    newSessionId: () => "sess_generated",
    registry: { elevenlabs_convai: runner },
    ...over,
  };
}

const TOKEN: VoiceSessionTokenPayload = {
  sessionId: "sess_1",
  projectId: "p1",
  agentId: null,
  agentExternalId: "agent_xyz",
  transport: "elevenlabs_convai",
  exp: 9_999_999_999_999,
};

const FINISH_BASE = {
  token: TOKEN,
  projectId: "p1",
  transcript: [{ role: "caller" as const, text: "hi" }],
  startedAt: 1000,
  endedAt: 5000,
  cutAtLimit: false,
  conversationId: "conv_1",
};

describe("mintVoiceSession", () => {
  describe("when the project has a key and the row is a voice agent", () => {
    /** @scenario "Session mint returns only the signed URL, the conversation id and the max duration" */
    it("returns the signed URL, a signed session token and the max duration — never the key", async () => {
      const ports = fakePorts(fakeRunner());
      const result = await mintVoiceSession(ports, {
        projectId: "p1",
        transport: "elevenlabs_convai",
        agentId: "agent_xyz",
        agentRowId: "agent_row",
        maxDurationSeconds: 300,
      });

      expect(result.transport).toBe("elevenlabs_convai");
      expect(result.maxDurationSeconds).toBe(300);
      expect(result.connect).toEqual({ signedUrl: "wss://signed.example/abc" });
      // The token binds the call to its project and vendor agent.
      const payload = JSON.parse(result.sessionToken);
      expect(payload).toMatchObject({
        projectId: "p1",
        agentExternalId: "agent_xyz",
        agentId: "agent_row",
        transport: "elevenlabs_convai",
      });
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL.apiKey);
    });

    it("mints against the vendor id from the stored row, ignoring what a body would have named", async () => {
      const resolveVoiceAgentRow = vi.fn(async () => ({
        id: "agent_row",
        agentExternalId: "agent_from_row",
      }));
      const mintSpy = vi.fn(async () => ({
        signedUrl: "wss://signed.example/abc",
      }));
      const ports = fakePorts(fakeRunner({ mintSession: mintSpy }), {
        resolveVoiceAgentRow,
      });

      const result = await mintVoiceSession(ports, {
        projectId: "p1",
        transport: "elevenlabs_convai",
        // A client-supplied agentId that must be ignored once a row exists.
        agentId: "agent_from_body",
        agentRowId: "agent_row",
        maxDurationSeconds: 300,
      });

      expect(mintSpy).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "agent_from_row" }),
      );
      expect(JSON.parse(result.sessionToken)).toMatchObject({
        agentExternalId: "agent_from_row",
        agentId: "agent_row",
      });
    });
  });

  describe("when there is no saved agent row yet (an unsaved draft)", () => {
    it("mints against the body's vendor agent id and carries a null row id", async () => {
      const resolveVoiceAgentRow = vi.fn();
      const ports = fakePorts(fakeRunner(), { resolveVoiceAgentRow });

      const result = await mintVoiceSession(ports, {
        projectId: "p1",
        transport: "elevenlabs_convai",
        agentId: "agent_xyz",
        maxDurationSeconds: 300,
      });

      expect(resolveVoiceAgentRow).not.toHaveBeenCalled();
      expect(JSON.parse(result.sessionToken)).toMatchObject({
        agentExternalId: "agent_xyz",
        agentId: null,
      });
    });
  });

  describe("when the named row is missing or not a voice agent", () => {
    it("refuses with VoiceAgentRowNotFoundError and never calls the transport", async () => {
      const runner = fakeRunner();
      const ports = fakePorts(runner, {
        resolveVoiceAgentRow: vi.fn(async () => null),
      });

      await expect(
        mintVoiceSession(ports, {
          projectId: "p1",
          transport: "elevenlabs_convai",
          agentId: "agent_xyz",
          agentRowId: "agent_row",
          maxDurationSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(VoiceAgentRowNotFoundError);
      expect(runner.mintSession).not.toHaveBeenCalled();
    });
  });

  describe("when the project has no key", () => {
    it("refuses with the missing-key message and never calls the transport", async () => {
      const runner = fakeRunner();
      const ports = fakePorts(runner, {
        resolveCredential: vi.fn(async () => null),
      });

      await expect(
        mintVoiceSession(ports, {
          projectId: "p1",
          transport: "elevenlabs_convai",
          agentId: "agent_xyz",
          agentRowId: "agent_row",
          maxDurationSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(VoiceKeyMissingError);
      expect(runner.mintSession).not.toHaveBeenCalled();
    });
  });
});

describe("finishVoiceSession", () => {
  describe("when the same conversation is finished twice", () => {
    /** @scenario "Hanging up twice produces exactly one run" */
    it("writes the run once and returns the existing run the second time", async () => {
      const runner = fakeRunner();
      let stored: string | null = null;
      const writeCallRun = vi.fn(async ({ scenarioRunId }) => {
        stored = scenarioRunId;
      });
      const findExistingRun = vi.fn(async ({ scenarioRunId }) =>
        stored === scenarioRunId ? { agentId: "agent_row" } : null,
      );
      const ports = fakePorts(runner, {
        writeCallRun,
        findExistingRun,
        createVoiceAgent: vi.fn(async () => ({ id: "agent_row" })),
      });

      const first = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        name: "Support",
      });
      const second = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        name: "Support",
      });

      expect(writeCallRun).toHaveBeenCalledTimes(1);
      expect(first.runId).toBe(second.runId);
    });
  });

  describe("when the drawer had no saved agent row", () => {
    it("creates the voice agent from the form values before writing the run", async () => {
      const runner = fakeRunner();
      const createVoiceAgent = vi.fn(async () => ({ id: "agent_new" }));
      const ports = fakePorts(runner, { createVoiceAgent });

      const result = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        name: "Support line",
      });

      expect(createVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Support line", agentId: "agent_xyz" }),
      );
      expect(result.agentId).toBe("agent_new");
    });
  });

  describe("when the provider record names a different agent than the token", () => {
    it("refuses without writing the run", async () => {
      const runner = fakeRunner({
        fetchCallRecord: vi.fn(
          async (): Promise<CallRecord> => ({
            conversationId: "conv_1",
            transport: "elevenlabs_convai",
            agentExternalId: "someone_elses_agent",
            startedAt: 1000,
            endedAt: 2000,
            durationMs: 1000,
            turns: [],
            cutAtLimit: false,
            source: "provider",
          }),
        ),
      });
      const writeCallRun = vi.fn<VoiceSessionPorts["writeCallRun"]>(
        async () => {},
      );
      const ports = fakePorts(runner, { writeCallRun });

      await expect(
        finishVoiceSession(ports, {
          ...FINISH_BASE,
          token: { ...TOKEN, agentId: "agent_row" },
        }),
      ).rejects.toBeInstanceOf(VoiceConversationMismatchError);
      expect(writeCallRun).not.toHaveBeenCalled();
    });
  });

  describe("when the limit ended the call", () => {
    it("carries the cut-at-limit flag onto the written record", async () => {
      const runner = fakeRunner();
      const writeCallRun = vi.fn<VoiceSessionPorts["writeCallRun"]>(
        async () => {},
      );
      const ports = fakePorts(runner, { writeCallRun });

      await finishVoiceSession(ports, {
        ...FINISH_BASE,
        token: { ...TOKEN, agentId: "agent_row" },
        cutAtLimit: true,
      });

      const written = writeCallRun.mock.calls[0]?.[0] as {
        record: CallRecord;
      };
      expect(written.record.cutAtLimit).toBe(true);
    });
  });

  describe("when the call is scored under a scenario", () => {
    /** @scenario "Call it myself against a scenario and be scored on its criteria" */
    it("writes the run under the scenario and its set so the scenario grades it", async () => {
      const runner = fakeRunner();
      const writeCallRun = vi.fn<VoiceSessionPorts["writeCallRun"]>(
        async () => {},
      );
      const resolveScenarioSet = vi.fn(async () => ({
        scenarioSetId: "set_x",
      }));
      const ports = fakePorts(runner, {
        writeCallRun,
        resolveScenarioSet,
        createVoiceAgent: vi.fn(async () => ({ id: "agent_row" })),
      });

      const result = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        token: { ...TOKEN, agentId: "agent_row" },
        scenarioId: "scenario_1",
      });

      expect(resolveScenarioSet).toHaveBeenCalledWith({
        projectId: "p1",
        scenarioId: "scenario_1",
      });
      expect(writeCallRun).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
        }),
      );
      expect(result.scenarioSetId).toBe("set_x");
    });

    it("keeps a drawer call out of any scenario set when no scenario is named", async () => {
      const runner = fakeRunner();
      const writeCallRun = vi.fn<VoiceSessionPorts["writeCallRun"]>(
        async () => {},
      );
      const resolveScenarioSet = vi.fn(async () => ({
        scenarioSetId: "set_x",
      }));
      const ports = fakePorts(runner, { writeCallRun, resolveScenarioSet });

      const result = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        token: { ...TOKEN, agentId: "agent_row" },
      });

      expect(resolveScenarioSet).not.toHaveBeenCalled();
      expect(writeCallRun.mock.calls[0]?.[0]).not.toHaveProperty("scenario");
      expect(result.scenarioSetId).toBeUndefined();
    });
  });

  describe("when a scenario call is finished", () => {
    /** @scenario "No ElevenLabs key leaves the server through any response or log" */
    it("returns no ElevenLabs key in the finish response", async () => {
      const runner = fakeRunner();
      const ports = fakePorts(runner, {
        resolveScenarioSet: vi.fn(async () => ({ scenarioSetId: "set_x" })),
      });

      const result = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        token: { ...TOKEN, agentId: "agent_row" },
        scenarioId: "scenario_1",
      });

      expect(JSON.stringify(result)).not.toContain(CREDENTIAL.apiKey);
    });
  });

  describe("when the provider fetch throws", () => {
    /** @scenario "A recording fetch failure keeps the live transcript and shows a fetch-failed notice" */
    it("keeps the live transcript and flags the fetch as failed", async () => {
      const runner = fakeRunner({
        fetchCallRecord: vi.fn(async () => {
          throw new Error("key rotated");
        }),
      });
      const ports = fakePorts(runner);

      const result = await finishVoiceSession(ports, {
        ...FINISH_BASE,
        token: { ...TOKEN, agentId: "agent_row" },
      });

      expect(result.fetchFailed).toBe(true);
      expect(result.source).toBe("browser");
      expect(result.hasAudio).toBe(false);
    });
  });
});
