import Parse from "papaparse";
import { describe, expect, it } from "vitest";
import type { ExportableRun } from "~/server/app-layer/simulations/repositories/simulation.repository";
import { ScenarioRunStatus, Verdict } from "~/server/scenarios/scenario-event.enums";
import {
  serializeRunsToCriteriaCsv,
  serializeRunsToFullCsv,
  serializeRunsToSummaryCsv,
} from "../csv-serializer";

function buildRun(overrides: Partial<ExportableRun> = {}): ExportableRun {
  return {
    scenarioRunId: "run_1",
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Refund Request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      reasoning: "The agent offered a refund.",
      metCriteria: ["stays polite"],
      unmetCriteria: [],
      error: undefined,
    },
    messages: [],
    timestamp: 1785177315009,
    updatedAt: 1785177315009,
    durationInMs: 8400,
    totalCost: 0.031,
    ...overrides,
  } as ExportableRun;
}

function parse(csv: string): Record<string, string>[] {
  return Parse.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
  }).data;
}

describe("scenario run CSV serializers", () => {
  describe("given summary mode", () => {
    it("writes one row per run", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [buildRun({ scenarioRunId: "a" }), buildRun({ scenarioRunId: "b" })],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.scenario_run_id)).toEqual(["a", "b"]);
    });

    it("reports criteria counts without requiring the JSON to be parsed", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "",
              metCriteria: ["a", "b"],
              unmetCriteria: ["c", "d", "e"],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });

      const row = parse(csv)[0]!;
      expect(row.met_criteria_count).toBe("2");
      expect(row.unmet_criteria_count).toBe("3");
    });

    it("encodes criteria as JSON so their commas survive a round trip", () => {
      const criterion = "stays polite, even when the customer escalates";
      const csv = serializeRunsToSummaryCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.SUCCESS,
              reasoning: "",
              metCriteria: [criterion],
              unmetCriteria: [],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });

      const row = parse(csv)[0]!;
      expect(JSON.parse(row.met_criteria!)).toEqual([criterion]);
    });

    it("writes timestamps as ISO-8601 UTC", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [buildRun({ timestamp: 1785177315009 })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.started_at).toBe("2026-07-27T18:35:15.009Z");
    });

    it("leaves cost empty when the run reported none", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [buildRun({ totalCost: undefined })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.total_cost).toBe("");
    });

    it("reports the run status alongside its outcome category", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [
          buildRun({ scenarioRunId: "a", status: ScenarioRunStatus.ERROR }),
          buildRun({ scenarioRunId: "b", status: ScenarioRunStatus.FAILED }),
          buildRun({ scenarioRunId: "c", status: ScenarioRunStatus.STALLED }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows.map((r) => [r.status, r.status_category])).toEqual([
        ["ERROR", "failure"],
        ["FAILED", "failure"],
        ["STALLED", "stalled"],
      ]);
    });

    it("emits no aggregate columns", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [buildRun()],
        includeHeader: true,
      });

      expect(csv.split("\n")[0]).not.toContain("pass_rate");
    });

    it("extracts the target from the langwatch metadata namespace", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [
          buildRun({
            metadata: {
              langwatch: {
                targetType: "http",
                targetReferenceId: "agent_42",
                simulationSuiteId: "suite_7",
              },
            },
          }),
        ],
        includeHeader: true,
      });

      const row = parse(csv)[0]!;
      expect(row.target_type).toBe("http");
      expect(row.target_reference_id).toBe("agent_42");
      expect(row.simulation_suite_id).toBe("suite_7");
    });

    it("leaves target columns empty when metadata has no langwatch namespace", () => {
      const csv = serializeRunsToSummaryCsv({
        runs: [buildRun({ metadata: { somethingElse: true } })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.target_type).toBe("");
    });
  });

  describe("given criteria mode", () => {
    it("writes one row per criterion, flagged met or unmet", () => {
      const csv = serializeRunsToCriteriaCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "",
              metCriteria: ["stays polite", "verifies identity"],
              unmetCriteria: ["offers a refund"],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => [r.criterion, r.met])).toEqual([
        ["stays polite", "true"],
        ["verifies identity", "true"],
        ["offers a refund", "false"],
      ]);
    });

    it("carries run context onto every criterion row so it can be pivoted", () => {
      const csv = serializeRunsToCriteriaCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "",
              metCriteria: [],
              unmetCriteria: ["a", "b"],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });

      for (const row of parse(csv)) {
        expect(row.scenario_run_id).toBe("run_1");
        expect(row.scenario_name).toBe("Refund Request");
        expect(row.status_category).toBe("success");
      }
    });

    it("contributes no rows for a run judged against no criteria", () => {
      const csv = serializeRunsToCriteriaCsv({
        runs: [
          buildRun({ scenarioRunId: "empty", results: null }),
          buildRun({
            scenarioRunId: "has-one",
            results: {
              verdict: Verdict.SUCCESS,
              reasoning: "",
              metCriteria: ["only one"],
              unmetCriteria: [],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scenario_run_id).toBe("has-one");
    });
  });

  describe("given full mode", () => {
    it("writes one row per message with run fields repeated", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            messages: [
              { role: "user", content: "I want my money back" },
              { role: "assistant", content: "Let me check that order" },
            ] as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.message_index)).toEqual(["0", "1"]);
      expect(rows.map((r) => r.message_role)).toEqual(["user", "assistant"]);
      expect(new Set(rows.map((r) => r.run_scenario_run_id))).toEqual(
        new Set(["run_1"]),
      );
    });

    it("still writes one row for a run that produced no messages", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ messages: [] as ExportableRun["messages"] })],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message_content).toBe("");
      expect(rows[0]!.run_scenario_run_id).toBe("run_1");
    });

    it("round-trips message content containing commas, quotes and newlines", () => {
      const content = 'He said "no, refund it".\nThen he left.';
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            messages: [
              { role: "user", content },
            ] as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.message_content).toBe(content);
    });

    it("stringifies structured message content instead of dropping it", () => {
      const parts = [{ type: "text", text: "hi" }];
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            messages: [
              { role: "user", content: parts },
            ] as unknown as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });

      expect(JSON.parse(parse(csv)[0]!.message_content!)).toEqual(parts);
    });
  });

  describe("when a batch is not the first of a streamed export", () => {
    it("omits the header so the file has exactly one", () => {
      const first = serializeRunsToSummaryCsv({
        runs: [buildRun()],
        includeHeader: true,
      });
      const second = serializeRunsToSummaryCsv({
        runs: [buildRun({ scenarioRunId: "run_2" })],
        includeHeader: false,
      });

      expect(first.split("\n")[0]).toContain("scenario_run_id");
      expect(second).not.toContain("scenario_run_id");
      expect(parse(first + second)).toHaveLength(2);
    });
  });
});
