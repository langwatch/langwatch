/**
 * @vitest-environment node
 * Unit tests for `writeVoiceCallRun`'s `metadata` shape — downstream
 * readers key off it, so a field landing wrong silently breaks them.
 */

import type { CallRecord } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createVoiceCallRunWriter } from "../voice-run-writer.ts";

const mockFindById = vi.fn();
const mockStartRun = vi.fn().mockResolvedValue(undefined);
const mockMessageSnapshot = vi.fn().mockResolvedValue(undefined);
const mockFinishRun = vi.fn().mockResolvedValue(undefined);

// The writer is composed over in-memory collaborators, the same way the
// module's composition composes it over the real ones.
const writeVoiceCallRun = createVoiceCallRunWriter({
  agents: { findById: (input) => mockFindById(input) },
  simulations: {
    startRun: async (input) => {
      await mockStartRun(input);
    },
    messageSnapshot: async (input) => {
      await mockMessageSnapshot(input);
    },
    finishRun: async (input) => {
      await mockFinishRun(input);
    },
  },
});

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
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: [],
        });

        const started = mockStartRun.mock.calls[0]?.[0] as
          | {
              metadata: {
                langwatch: { isCutAtLimit?: boolean };
                isCutAtLimit?: unknown;
              };
            }
          | undefined;
        expect(started?.metadata.langwatch.isCutAtLimit).toBe(true);
        expect(started?.metadata.isCutAtLimit).toBeUndefined();
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
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: ["trace_0"],
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
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: ["trace_0", "trace_0"],
        };

        await writeVoiceCallRun(args);
        await writeVoiceCallRun(args);

        const idsOf = (call: number) =>
          (
            mockMessageSnapshot.mock.calls[call]?.[0] as
              | {
                  messages: { id: string }[];
                }
              | undefined
          )?.messages.map((m) => m.id);
        expect(idsOf(0)).toEqual(["run_1-0", "run_1-1"]);
        expect(idsOf(0)).toEqual(idsOf(1));
      });
    });

    describe("when the turns carry per-exchange trace ids", () => {
      /** @scenario "Browser call writes one trace per exchange; messages link to trace" */
      it("sets trace_id on each message and lists the ids on the snapshot", async () => {
        const record = fakeRecord({
          turns: [
            { role: "caller", text: "hi" },
            { role: "agent", text: "hello" },
          ],
        });

        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record,
          // Both turns are one exchange, so they share the trace id.
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: ["trace_a", "trace_a"],
        });

        const snapshot = mockMessageSnapshot.mock.calls[0]?.[0] as {
          messages: { trace_id?: string }[];
          traceIds: string[];
        };
        expect(snapshot.messages.map((m) => m.trace_id)).toEqual(["trace_a", "trace_a"]);
        expect(snapshot.traceIds).toEqual(["trace_a", "trace_a"]);
      });
    });
  });
});
