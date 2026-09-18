/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { CallRecord } from "../call-record";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";
import {
  VoiceKeyMissingError,
  type VoiceSessionPorts,
  finishVoiceSession,
  mintVoiceSession,
} from "../voice-session.service";

const CREDENTIAL: VoiceTransportCredential = {
  apiKey: "sk-secret-123",
  baseUrl: "https://api.elevenlabs.io",
};

function fakeRunner(over: Partial<VoiceTransportRunner> = {}): VoiceTransportRunner {
  return {
    missingKeyMessage: "No ElevenLabs key in this project",
    createAgentAdapter: () => ({}) as never,
    mintSession: vi.fn(async () => ({ signedUrl: "wss://signed.example/abc" })),
    fetchCallRecord: vi.fn(async () => null),
    ...over,
  };
}

function fakePorts(
  runner: VoiceTransportRunner,
  over: Partial<VoiceSessionPorts> = {},
): VoiceSessionPorts {
  return {
    resolveCredential: vi.fn(async () => CREDENTIAL),
    findExistingRun: vi.fn(async () => null),
    createVoiceAgent: vi.fn(async () => ({ id: "agent_created" })),
    writeCallRun: vi.fn(async () => {}),
    audioProxyUrl: ({ conversationId }) => `/api/voice/session/${conversationId}/audio`,
    now: () => 1000,
    newSessionId: () => "sess_generated",
    registry: { elevenlabs_convai: runner },
    ...over,
  };
}

const FINISH_BASE = {
  projectId: "p1",
  transport: "elevenlabs_convai" as const,
  agentId: "agent_xyz",
  transcript: [{ role: "caller" as const, text: "hi" }],
  startedAt: 1000,
  endedAt: 5000,
  cutAtLimit: false,
  conversationId: "conv_1",
  sessionId: "sess_1",
};

describe("mintVoiceSession", () => {
  describe("when the project has a key", () => {
    /** @scenario "Session mint returns only the signed URL, the conversation id and the max duration" */
    it("returns only the signed URL, the session id and the max duration — never the key", async () => {
      const ports = fakePorts(fakeRunner());
      const result = await mintVoiceSession(ports, {
        projectId: "p1",
        transport: "elevenlabs_convai",
        agentId: "agent_xyz",
        maxDurationSeconds: 300,
      });

      expect(result).toEqual({
        transport: "elevenlabs_convai",
        sessionId: "sess_generated",
        maxDurationSeconds: 300,
        connect: { signedUrl: "wss://signed.example/abc" },
      });
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL.apiKey);
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
          maxDurationSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(VoiceKeyMissingError);
      expect(runner.mintSession).not.toHaveBeenCalled();
    });
  });
});

describe("finishVoiceSession", () => {
  describe("when the same conversation is finished twice", () => {
    /** @scenario "Hanging up twice, a mid-call reload and a late webhook each produce exactly one run" */
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

  describe("when the limit ended the call", () => {
    it("carries the cut-at-limit flag onto the written record", async () => {
      const runner = fakeRunner();
      const writeCallRun = vi.fn(async () => {});
      const ports = fakePorts(runner, { writeCallRun });

      await finishVoiceSession(ports, {
        ...FINISH_BASE,
        agentRowId: "agent_row",
        cutAtLimit: true,
      });

      const written = writeCallRun.mock.calls[0]?.[0] as {
        record: CallRecord;
      };
      expect(written.record.cutAtLimit).toBe(true);
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
        agentRowId: "agent_row",
      });

      expect(result.fetchFailed).toBe(true);
      expect(result.source).toBe("browser");
      expect(result.hasAudio).toBe(false);
    });
  });
});
