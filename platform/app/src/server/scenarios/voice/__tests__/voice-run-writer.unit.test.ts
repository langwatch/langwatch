/**
 * @vitest-environment node
 *
 * Unit tests for {@link writeVoiceCallRun}'s `metadata` shape — the piece
 * downstream readers (results table, run header) key off, so a field landing
 * in the wrong place silently breaks them without a type error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindById = vi.fn();
vi.mock("~/server/agents/agent.repository", () => ({
  AgentRepository: class {
    findById({ projectId, id }: { projectId: string; id: string }) {
      return mockFindById({ projectId, id });
    }
  },
}));

const mockStartRun = vi.fn().mockResolvedValue(undefined);
const mockMessageSnapshot = vi.fn().mockResolvedValue(undefined);
const mockFinishRun = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn().mockReturnValue({
    simulations: {
      startRun: (...args: unknown[]) => mockStartRun(...args),
      messageSnapshot: (...args: unknown[]) => mockMessageSnapshot(...args),
      finishRun: (...args: unknown[]) => mockFinishRun(...args),
    },
  }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

import type { CallRecord } from "../call-record";
import { writeVoiceCallRun } from "../voice-run-writer";

function fakeRecord(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    conversationId: "conv_1",
    transport: "elevenlabs_convai",
    startedAt: 1,
    endedAt: 2,
    durationMs: 1000,
    turns: [],
    cutAtLimit: false,
    source: "provider",
    ...overrides,
  };
}

describe("writeVoiceCallRun", () => {
  describe("given the agent row exists", () => {
    beforeEach(() => {
      mockFindById.mockResolvedValue({ id: "agent_1" });
    });

    describe("when the call was cut at the limit", () => {
      it("nests cutAtLimit under metadata.langwatch", async () => {
        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record: fakeRecord({ cutAtLimit: true }),
        });

        const { metadata } = mockStartRun.mock.calls[0]?.[0] as {
          metadata: {
            langwatch: { cutAtLimit?: boolean };
            cutAtLimit?: unknown;
          };
        };
        expect(metadata.langwatch.cutAtLimit).toBe(true);
        expect(metadata.cutAtLimit).toBeUndefined();
      });
    });
  });
});
