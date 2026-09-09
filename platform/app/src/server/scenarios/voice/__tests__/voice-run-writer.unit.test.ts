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
    isCutAtLimit: false,
    source: "provider",
    ...overrides,
  };
}

describe("writeVoiceCallRun", () => {
  beforeEach(() => {
    // Per test: the command dispatch counts (finishRun especially) must not
    // carry across tests. Only call counts reset — implementations stay.
    vi.clearAllMocks();
  });

  describe("given the agent row exists", () => {
    beforeEach(() => {
      mockFindById.mockResolvedValue({ id: "agent_1" });
    });

    describe("when the call was cut at the limit", () => {
      it("nests isCutAtLimit under metadata.langwatch", async () => {
        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record: fakeRecord({ isCutAtLimit: true }),
        });

        const { metadata } = mockStartRun.mock.calls[0]?.[0] as {
          metadata: {
            langwatch: { isCutAtLimit?: boolean };
            isCutAtLimit?: unknown;
          };
        };
        expect(metadata.langwatch.isCutAtLimit).toBe(true);
        expect(metadata.isCutAtLimit).toBeUndefined();
      });
    });

    describe("when a snapshot fails after startRun and the finish is retried", () => {
      /** @scenario "A retried hang-up completes a half-written run" */
      it("completes on retry and emits finishRun exactly once", async () => {
        mockMessageSnapshot
          .mockRejectedValueOnce(new Error("snapshot write failed"))
          .mockResolvedValue(undefined);
        const record = fakeRecord({
          turns: [{ role: "caller", text: "hi" }],
        });
        const args = {
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record,
        };

        await expect(writeVoiceCallRun(args)).rejects.toThrow();
        await writeVoiceCallRun(args);

        expect(mockFinishRun).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the same record is written twice", () => {
      /** @scenario "A retried hang-up completes a half-written run" */
      it("derives identical message ids from the run id and turn index", async () => {
        const record = fakeRecord({
          turns: [
            { role: "caller", text: "hi" },
            { role: "agent", text: "hello" },
          ],
        });
        const args = {
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record,
        };

        await writeVoiceCallRun(args);
        await writeVoiceCallRun(args);

        const idsOf = (call: number) =>
          (
            mockMessageSnapshot.mock.calls[call]?.[0] as {
              messages: { id: string }[];
            }
          ).messages.map((m) => m.id);
        expect(idsOf(0)).toEqual(["run_1-0", "run_1-1"]);
        expect(idsOf(0)).toEqual(idsOf(1));
      });
    });
  });
});
