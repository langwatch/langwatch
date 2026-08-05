/**
 * Unit tests for choosing which conversations the model reads.
 *
 * The property that matters is breadth before depth: with a budget too small
 * for everything, every distinct failure mode must be represented before any
 * one mode gets a second example. Otherwise a report can read twenty copies of
 * the loudest failure and never see the other four.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { FailureSignature, RunFact } from "../../report.types";
import { selectTranscripts } from "../transcript-budget";

function runData(runId: string, turns: number): ScenarioRunData {
  return {
    scenarioId: `scen_${runId}`,
    batchRunId: "batch_1",
    scenarioRunId: runId,
    name: `Scenario ${runId}`,
    description: null,
    metadata: null,
    status: ScenarioRunStatus.FAILED,
    results: {
      verdict: Verdict.FAILURE,
      metCriteria: [],
      unmetCriteria: ["x"],
    },
    messages: Array.from({ length: turns }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn ${index}`,
    })) as never,
    timestamp: 1,
    durationInMs: 1,
  };
}

function runFact(runId: string, turns: number): RunFact {
  return {
    runId,
    scenarioId: `scen_${runId}`,
    scenarioName: `Scenario ${runId}`,
    status: ScenarioRunStatus.FAILED,
    category: "failure",
    verdict: "failure",
    reasoning: null,
    metCriteria: [],
    unmetCriteria: ["x"],
    error: null,
    turnCount: turns,
    durationMs: 1,
    cost: null,
  };
}

function signature(id: string, runIds: string[]): FailureSignature {
  return {
    signatureId: id,
    kind: "judged",
    unmetCriterionIds: ["c_1"],
    errorShape: null,
    errorExample: null,
    runIds,
    scenarioIds: runIds.map((runId) => `scen_${runId}`),
  };
}

function select({
  signatures,
  runIds,
  maxTranscripts,
  turns = 4,
}: {
  signatures: FailureSignature[];
  runIds: string[];
  maxTranscripts?: number;
  turns?: number;
}) {
  return selectTranscripts({
    signatures,
    runFacts: runIds.map((runId) => runFact(runId, turns)),
    runsById: new Map(runIds.map((runId) => [runId, runData(runId, turns)])),
    maxTranscripts,
  });
}

describe("selectTranscripts()", () => {
  describe("when the budget is smaller than the number of failing runs", () => {
    /** @scenario Reading a sample of conversations is disclosed */
    it("represents every failure mode before repeating one", () => {
      const result = select({
        signatures: [
          signature("s_loud", ["r1", "r2", "r3", "r4", "r5"]),
          signature("s_quiet", ["r6"]),
        ],
        runIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
        maxTranscripts: 2,
      });

      expect(result.transcripts).toHaveLength(2);
      expect(result.transcripts.map((it) => it.signatureId).sort()).toEqual([
        "s_loud",
        "s_quiet",
      ]);
      expect(result.signaturesCovered).toBe(2);
    });
  });

  describe("when the same run is selected twice", () => {
    it("picks the same conversations both times", () => {
      const args = {
        signatures: [signature("s_a", ["r3", "r1", "r2"])],
        runIds: ["r1", "r2", "r3"],
        maxTranscripts: 2,
      };

      const first = select(args).transcripts.map((it) => it.runId);
      const second = select(args).transcripts.map((it) => it.runId);

      expect(first).toEqual(second);
    });
  });

  describe("when a conversation is longer than the tail kept", () => {
    it("keeps the opening turn and the tail, and counts what it dropped", () => {
      const [transcript] = select({
        signatures: [signature("s_a", ["r1"])],
        runIds: ["r1"],
        turns: 30,
      }).transcripts;

      expect(transcript?.turns[0]?.index).toBe(0);
      expect(transcript?.turns.at(-1)?.index).toBe(29);
      expect(transcript?.omittedTurns).toBeGreaterThan(0);
      expect(
        (transcript?.turns.length ?? 0) + (transcript?.omittedTurns ?? 0),
      ).toBe(30);
    });
  });

  describe("when nothing failed", () => {
    it("selects nothing rather than throwing", () => {
      const result = select({ signatures: [], runIds: [] });

      expect(result.transcripts).toEqual([]);
      expect(result.signaturesCovered).toBe(0);
    });
  });
});
