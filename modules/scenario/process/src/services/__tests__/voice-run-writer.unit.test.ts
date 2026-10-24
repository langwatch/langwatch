/**
 * @vitest-environment node
 * Unit tests for `writeVoiceCallRun`'s `metadata` shape — downstream
 * readers key off it, so a field landing wrong silently breaks them.
 */

import type { CallRecord } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceCallRunService } from "../../features/voice/services/voice-call-run.service.ts";

const mockFindById = vi.fn();
const mockStartRun = vi.fn().mockResolvedValue(undefined);
const mockMessageSnapshot = vi.fn().mockResolvedValue(undefined);
const mockFinishRun = vi.fn().mockResolvedValue(undefined);
const mockRefreshMetadata = vi.fn().mockResolvedValue(undefined);

// The writer is composed over in-memory collaborators, the same way the
// module's composition composes it over the real ones.
const { writeCallRun: writeVoiceCallRun } = VoiceCallRunService.create({
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
    refreshMetadata: async (input) => {
      await mockRefreshMetadata(input);
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
        const snapshotFailure = new Error("snapshot write failed");
        mockMessageSnapshot.mockRejectedValueOnce(snapshotFailure).mockResolvedValue(undefined);
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

        await expect(writeVoiceCallRun(args)).rejects.toBe(snapshotFailure);
        await writeVoiceCallRun(args);

        expect(mockFinishRun).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the write is a re-drive", () => {
      /** @scenario "A re-driven run's metadata is refreshed to the latest attempt" */
      it("emits a refresh carrying this attempt's source, audio and cutoff (#8032)", async () => {
        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record: fakeRecord({
            source: "provider",
            audioUrl: "https://audio.example/run_1.wav",
            isCutAtLimit: true,
          }),
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: [],
          isRedrive: true,
        });

        expect(mockRefreshMetadata).toHaveBeenCalledTimes(1);
        const refresh = mockRefreshMetadata.mock.calls[0]?.[0] as {
          scenarioRunId: string;
          attemptId: string;
          metadata: { source: string; audioUrl: string | null; langwatch: { isCutAtLimit: boolean } };
        };
        expect(refresh.scenarioRunId).toBe("run_1");
        expect(refresh.attemptId).toBeTruthy();
        expect(refresh.metadata.source).toBe("provider");
        expect(refresh.metadata.audioUrl).toBe("https://audio.example/run_1.wav");
        expect(refresh.metadata.langwatch.isCutAtLimit).toBe(true);
      });

      it("clears a stale audio link when this attempt has no recording", async () => {
        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          // A browser-sourced attempt carries no recording (audioUrl omitted).
          record: fakeRecord({ source: "browser" }),
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: [],
          isRedrive: true,
        });

        const refresh = mockRefreshMetadata.mock.calls[0]?.[0] as {
          metadata: { audioUrl: string | null };
        };
        // The refresh maps an absent recording to an explicit null, so the fold
        // clears a stale link the first attempt may have written (#8032).
        expect(refresh.metadata.audioUrl).toBeNull();
      });

      it("does not refresh on a first write — the started event already carries the metadata", async () => {
        await writeVoiceCallRun({
          projectId: "project_1",
          scenarioRunId: "run_1",
          agentRowId: "agent_1",
          agentDisplayName: "Support Bot",
          record: fakeRecord(),
          scenario: { scenarioId: "scenario_1", scenarioSetId: "set_x" },
          turnTraceIds: [],
        });

        expect(mockRefreshMetadata).not.toHaveBeenCalled();
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
      /** @scenario "A finished browser call writes one trace per exchange and every message links to its exchange's trace" */
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
