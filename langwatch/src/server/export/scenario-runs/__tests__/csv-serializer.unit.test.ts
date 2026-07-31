import Parse from "papaparse";
import { describe, expect, it } from "vitest";
import type { ExportableRun } from "~/server/app-layer/simulations/repositories/simulation.repository";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import {
  serializeRunsToCriteriaCsv,
  serializeRunsToFullCsv,
} from "../csv-serializer";

function buildRun(overrides: Partial<ExportableRun> = {}): ExportableRun {
  return {
    scenarioRunId: "run_1",
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Refund Request",
    description: "Customer wants money back after two weeks",
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
    traceIds: [],
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
  describe("when writing the header of any mode", () => {
    // Column order is a design decision, not an accident: spreadsheets show
    // the leftmost columns first, so the readable ones lead and identifiers
    // trail. Pinned here so a later edit cannot quietly bury them again.
    const IDENTIFIER_COLUMNS = [
      "scenario_run_id",
      "scenario_id",
      "batch_run_id",
      "scenario_set_id",
      "trace_ids",
    ];

    it("leads with the columns a person reads", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun()],
        includeHeader: true,
      });
      const header = csv.split("\r\n")[0]!.split(",");

      expect(header.slice(0, 4)).toEqual([
        "run_scenario_name",
        "run_status",
        "run_status_category",
        "run_verdict",
      ]);
    });

    it("puts every identifier after the readable columns", () => {
      for (const csv of [
        serializeRunsToFullCsv({ runs: [buildRun()], includeHeader: true }),
        serializeRunsToCriteriaCsv({ runs: [buildRun()], includeHeader: true }),
        serializeRunsToFullCsv({ runs: [buildRun()], includeHeader: true }),
      ]) {
        const header = csv.split("\r\n")[0]!.split(",");
        const firstIdentifier = Math.min(
          ...IDENTIFIER_COLUMNS.map((c) =>
            header.findIndex((h) => h.replace(/^run_/, "") === c),
          ).filter((i) => i >= 0),
        );
        const verdictAt = header.findIndex(
          (h) => h.replace(/^run_/, "") === "verdict",
        );
        const reasoningAt = header.findIndex(
          (h) => h.replace(/^run_/, "") === "reasoning",
        );

        expect(verdictAt).toBeLessThan(firstIdentifier);
        expect(reasoningAt).toBeLessThan(firstIdentifier);
      }
    });

    it("keeps the mode's own payload ahead of the identifiers", () => {
      const criteria = serializeRunsToCriteriaCsv({
        runs: [buildRun()],
        includeHeader: true,
      })
        .split("\r\n")[0]!
        .split(",");
      const full = serializeRunsToFullCsv({
        runs: [buildRun()],
        includeHeader: true,
      })
        .split("\r\n")[0]!
        .split(",");

      expect(criteria.indexOf("criterion")).toBeLessThan(
        criteria.indexOf("scenario_run_id"),
      );
      expect(full.indexOf("message_content")).toBeLessThan(
        full.indexOf("run_scenario_run_id"),
      );
    });
  });

  describe("when exporting in full mode", () => {
    it("writes one row per run when the run has no messages", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({ scenarioRunId: "a" }),
          buildRun({ scenarioRunId: "b" }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.run_scenario_run_id)).toEqual(["a", "b"]);
    });

    it("reports criteria counts without requiring the JSON to be parsed", () => {
      const csv = serializeRunsToFullCsv({
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
      expect(row.run_met_criteria_count).toBe("2");
      expect(row.run_unmet_criteria_count).toBe("3");
    });

    it("encodes criteria as JSON so their commas survive a round trip", () => {
      const criterion = "stays polite, even when the customer escalates";
      const csv = serializeRunsToFullCsv({
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
      expect(JSON.parse(row.run_met_criteria!)).toEqual([criterion]);
    });

    it("writes timestamps as ISO-8601 UTC", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ timestamp: 1785177315009 })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.run_started_at).toBe("2026-07-27T18:35:15.009Z");
    });

    it("leaves cost empty when the run reported none", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ totalCost: undefined })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.run_total_cost).toBe("");
    });

    it("reports the run status alongside its outcome category", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({ scenarioRunId: "a", status: ScenarioRunStatus.ERROR }),
          buildRun({ scenarioRunId: "b", status: ScenarioRunStatus.FAILED }),
          buildRun({ scenarioRunId: "c", status: ScenarioRunStatus.STALLED }),
        ],
        includeHeader: true,
      });

      const rows = parse(csv);
      expect(rows.map((r) => [r.run_status, r.run_status_category])).toEqual([
        ["ERROR", "failure"],
        ["FAILED", "failure"],
        ["STALLED", "stalled"],
      ]);
    });

    it("emits no aggregate columns", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun()],
        includeHeader: true,
      });

      expect(csv.split("\n")[0]).not.toContain("pass_rate");
    });

    it("extracts the target from the langwatch metadata namespace", () => {
      const csv = serializeRunsToFullCsv({
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
      expect(row.run_target_type).toBe("http");
      expect(row.run_target_reference_id).toBe("agent_42");
      expect(row.run_simulation_suite_id).toBe("suite_7");
    });

    it("carries the scenario description", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ description: "Tests refund policy under pressure" })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.run_scenario_description).toBe(
        "Tests refund policy under pressure",
      );
    });

    it("unions run-level and per-message trace ids without duplicating", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            traceIds: ["trace_a", "trace_b"],
            messages: [
              { role: "user", content: "hi", trace_id: "trace_b" },
              { role: "assistant", content: "yo", trace_id: "trace_c" },
            ] as unknown as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });

      expect(JSON.parse(parse(csv)[0]!.run_trace_ids!)).toEqual([
        "trace_a",
        "trace_b",
        "trace_c",
      ]);
    });

    it("leaves target columns empty when metadata has no langwatch namespace", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ metadata: { somethingElse: true } })],
        includeHeader: true,
      });

      expect(parse(csv)[0]!.run_target_type).toBe("");
    });
  });

  describe("when a cell begins with a spreadsheet formula character", () => {
    // Quoting satisfies RFC 4180 but does nothing to stop Excel or Sheets
    // evaluating a leading =, +, - or @. Every one of these fields is user- or
    // model-controlled, and the file exists to be opened in a spreadsheet.
    const DANGEROUS = '=HYPERLINK("http://evil.test","click")';

    it("neutralizes the scenario name", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ name: DANGEROUS })],
        includeHeader: true,
      });
      expect(parse(csv)[0]!.run_scenario_name).toBe(`'${DANGEROUS}`);
    });

    it("neutralizes the scenario description", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ description: DANGEROUS })],
        includeHeader: true,
      });
      expect(parse(csv)[0]!.run_scenario_description).toBe(`'${DANGEROUS}`);
    });

    it("neutralizes judge reasoning and error text", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: DANGEROUS,
              metCriteria: [],
              unmetCriteria: [],
              error: "+1+1",
            },
          }),
        ],
        includeHeader: true,
      });
      const row = parse(csv)[0]!;
      expect(row.run_reasoning).toBe(`'${DANGEROUS}`);
      expect(row.run_error).toBe("'+1+1");
    });

    it("neutralizes message content", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            messages: [
              { role: "user", content: DANGEROUS },
            ] as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });
      expect(parse(csv)[0]!.message_content).toBe(`'${DANGEROUS}`);
    });

    it("neutralizes a criterion", () => {
      const csv = serializeRunsToCriteriaCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "",
              metCriteria: [],
              unmetCriteria: [DANGEROUS],
              error: undefined,
            },
          }),
        ],
        includeHeader: true,
      });
      expect(parse(csv)[0]!.criterion).toBe(`'${DANGEROUS}`);
    });

    it("leaves ordinary text and negative numbers alone", () => {
      const csv = serializeRunsToFullCsv({
        runs: [buildRun({ name: "Refund Request", durationInMs: -1 })],
        includeHeader: true,
      });
      const row = parse(csv)[0]!;
      expect(row.run_scenario_name).toBe("Refund Request");
      expect(row.run_duration_ms).toBe("-1");
    });
  });

  describe("when exporting in criteria mode", () => {
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

  describe("when exporting a conversation in full mode", () => {
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

    it("carries the criteria that failed, not just how many", () => {
      const csv = serializeRunsToFullCsv({
        runs: [
          buildRun({
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "The agent asked a clarifying question.",
              metCriteria: ["stays polite"],
              unmetCriteria: ["offers a refund", "does not ask questions"],
              error: undefined,
            },
            messages: [
              { role: "user", content: "refund please" },
            ] as ExportableRun["messages"],
          }),
        ],
        includeHeader: true,
      });

      const row = parse(csv)[0]!;
      expect(row.run_unmet_criteria_count).toBe("2");
      expect(JSON.parse(row.run_unmet_criteria!)).toEqual([
        "offers a refund",
        "does not ask questions",
      ]);
      expect(JSON.parse(row.run_met_criteria!)).toEqual(["stays polite"]);
      expect(row.run_reasoning).toBe("The agent asked a clarifying question.");
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
            messages: [{ role: "user", content }] as ExportableRun["messages"],
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
      const first = serializeRunsToFullCsv({
        runs: [buildRun()],
        includeHeader: true,
      });
      const second = serializeRunsToFullCsv({
        runs: [buildRun({ scenarioRunId: "run_2" })],
        includeHeader: false,
      });

      expect(first.split("\n")[0]).toContain("scenario_run_id");
      expect(second).not.toContain("scenario_run_id");
      expect(parse(first + second)).toHaveLength(2);
    });
  });
});
