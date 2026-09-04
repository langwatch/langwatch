/**
 * @vitest-environment jsdom
 *
 * The evaluator results of a run, on every surface that reads them: the pills
 * of the run header, the pills of a result row, the verdict label of a row,
 * and the Evaluators section of the run drawer's verdict panel.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import { RunVerdictPanel } from "../drawers/RunVerdictPanel";
import { summarizeEvaluations } from "../results/evaluation-summaries";
import {
  RunPlanDetailHeader,
  type RunPlanDetailHeaderProps,
} from "../results/RunPlanDetailHeader";
import { RunResultsTable } from "../results/RunResultsTable";
import type { RunPlan } from "../results/run-plans";
import { LastResultLabel } from "../shared/LastResultLabel";
import { passRateColor } from "../shared/pass-rate-color";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The CSS variable Chakra emits for a colour token. */
function cssVarOfToken(token: string) {
  return `var(--chakra-colors-${token.replace(".", "-")})`;
}

const PASSED_COLOR = cssVarOfToken(
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor,
);
const FAILED_COLOR = cssVarOfToken(
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.FAILED].fgColor,
);

function makeEvaluation(
  overrides: Partial<ScenarioEvaluationResult> = {},
): ScenarioEvaluationResult {
  return {
    evaluatorId: "eval_sql",
    name: "SQL Query Equivalence",
    status: "passed",
    required: true,
    passed: true,
    ...overrides,
  };
}

const sqlPassed = makeEvaluation();
const sqlFailed = makeEvaluation({
  status: "failed",
  passed: false,
  details:
    "Generated SQL filters on fiscal quarter; golden uses calendar quarter",
});
const sqlSkipped = makeEvaluation({
  status: "skipped",
  passed: undefined,
  details: "no golden_sql on this scenario",
});
const latencyScore = makeEvaluation({
  evaluatorId: "eval_latency",
  name: "Reply Latency",
  status: "scored",
  required: false,
  passed: undefined,
  score: 2.6,
  details: "median agent reply",
});

function makeRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Chargeback totals by quarter",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      metCriteria: ["a", "b", "c"],
      unmetCriteria: [],
    },
    messages: [],
    timestamp: 1_700_000_000_000,
    durationInMs: 6300,
    totalCost: 0.0042,
    ...overrides,
  } as ScenarioRunData;
}

const plan: RunPlan = {
  slug: "case-lookups",
  name: "Case lookups",
  kind: "suite",
  scopeKind: "test_suites",
  scopeLabel: "3 scenarios",
  scenarioSetId: "set_1",
  suiteId: "suite_1",
  caseCount: 3,
  lastRun: null,
};

const summary = {
  passRate: 67,
  passedCount: 2,
  failedCount: 1,
  stalledCount: 0,
  cancelledCount: 0,
  completedCount: 3,
  totalCount: 3,
  inProgressCount: 0,
  queuedCount: 0,
  totalCost: 0.5,
  averageAgentLatencyMs: null,
  totalDurationMs: 12_000,
  agentLatencyStats: null,
  agentCostStats: null,
  averageAgentCost: null,
};

function renderHeader(runs: ScenarioRunData[], note: string | null = null) {
  const props: RunPlanDetailHeaderProps = {
    plan,
    run: {
      title: "Run #3",
      note,
      summary,
      evaluators: summarizeEvaluations({ runs }),
    },
    viewMode: "table",
    onViewModeChange: vi.fn(),
    isStoppingAll: false,
    onExport: vi.fn(),
    isExportDisabled: false,
    onEditPlan: vi.fn(),
    isRunSettingsShown: false,
    onToggleRunSettings: vi.fn(),
  };
  return render(<RunPlanDetailHeader {...props} />, { wrapper: Wrapper });
}

function renderTable(runs: ScenarioRunData[]) {
  return render(
    <RunResultsTable
      scenarioRuns={runs}
      resolveTargetName={() => null}
      iterationMap={new Map()}
      onScenarioRunClick={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
}

/** Three scenarios of one run: the check passed twice, failed once, and one score. */
function threeScenarioRuns(): ScenarioRunData[] {
  return [
    makeRun({
      scenarioRunId: "run_a",
      results: {
        verdict: Verdict.SUCCESS,
        metCriteria: ["a"],
        unmetCriteria: [],
        evaluations: [sqlPassed, latencyScore],
      },
    }),
    makeRun({
      scenarioRunId: "run_b",
      results: {
        verdict: Verdict.SUCCESS,
        metCriteria: ["a"],
        unmetCriteria: [],
        evaluations: [sqlPassed, makeEvaluation({ ...latencyScore, score: 3 })],
      },
    }),
    makeRun({
      scenarioRunId: "run_c",
      status: ScenarioRunStatus.FAILED,
      results: {
        verdict: Verdict.FAILURE,
        metCriteria: ["a"],
        unmetCriteria: [],
        evaluations: [sqlFailed, makeEvaluation({ ...latencyScore, score: 2 })],
      },
    }),
  ];
}

describe("<RunPlanDetailHeader/> evaluator pills", () => {
  afterEach(cleanup);

  describe("given a run of a plan that carries evaluators", () => {
    /** @scenario "The evaluator pills read after the pass block" */
    it("reads the pills after the pass block, at its size, and before the note", () => {
      renderHeader(threeScenarioRuns(), "switched judge");

      const line = screen.getByTestId("run-summary-line");
      const pass = within(line).getByTestId("run-metrics-summary");
      const pills = within(line).getByTestId("run-summary-evaluators");
      const note = within(line).getByTestId("run-summary-note");

      expect(
        pass.compareDocumentPosition(pills) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        pills.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The pass block of a header line is 32px tall, and so is every pill.
      for (const pill of within(pills).getAllByTestId(
        /^evaluator-pill-eval_/,
      )) {
        expect(pill).toHaveStyle({ height: "32px" });
      }
    });

    /** @scenario "A score evaluator carries no threshold and no colour" */
    it("colours the pass or fail pill by its rate and leaves the score pill plain", () => {
      renderHeader(threeScenarioRuns());

      const sql = screen.getByTestId("evaluator-pill-eval_sql");
      const latency = screen.getByTestId("evaluator-pill-eval_latency");

      expect(sql).toHaveAttribute("data-reading", "rate");
      expect(within(sql).getByTestId("evaluator-pill-dot")).toHaveStyle({
        backgroundColor: cssVarOfToken(passRateColor(67)),
      });

      expect(latency).toHaveAttribute("data-reading", "score");
      expect(latency).toHaveTextContent("Reply Latency");
      // The mean of 2.6, 3 and 2, with no dot, no threshold and no percent.
      expect(latency).toHaveTextContent("2.53");
      expect(
        within(latency).queryByTestId("evaluator-pill-dot"),
      ).not.toBeInTheDocument();
      expect(latency).not.toHaveTextContent("%");
    });

    /** @scenario "A pass or fail evaluator reads its pass rate over the run" */
    it("reads the pass rate over the scenarios it passed or failed", () => {
      const runs = threeScenarioRuns();
      // A fourth scenario left the check nothing to read: it counts in no rate.
      runs.push(
        makeRun({
          scenarioRunId: "run_d",
          results: {
            verdict: Verdict.SUCCESS,
            metCriteria: ["a"],
            unmetCriteria: [],
            evaluations: [sqlSkipped],
          },
        }),
      );
      renderHeader(runs);

      expect(screen.getByTestId("evaluator-pill-eval_sql")).toHaveTextContent(
        "67%",
      );
    });
  });

  describe("given a run of a plan that carries no evaluators", () => {
    /** @scenario "A run without evaluators shows no evaluator pills" */
    it("draws no pill after the pass block", () => {
      renderHeader([makeRun()]);

      expect(screen.getByTestId("run-metrics-summary")).toBeInTheDocument();
      expect(
        screen.queryByTestId("run-summary-evaluators"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("<RunResultsTable/> evaluator cells", () => {
  afterEach(cleanup);

  describe("given a finished run whose scenarios ran two evaluators", () => {
    /** @scenario "A result row carries one pill per evaluator" */
    it("holds one pill per evaluator, a dot on the verdict and none on the score", () => {
      renderTable([
        makeRun({
          status: ScenarioRunStatus.FAILED,
          results: {
            verdict: Verdict.FAILURE,
            metCriteria: ["a"],
            unmetCriteria: [],
            evaluations: [sqlFailed, latencyScore],
          },
        }),
      ]);

      const cell = screen.getByTestId("run-result-evaluators");
      expect(within(cell).getAllByTestId(/^evaluator-pill-eval_/)).toHaveLength(
        2,
      );

      const sql = within(cell).getByTestId("evaluator-pill-eval_sql");
      expect(sql).toHaveTextContent("Fail");
      expect(within(sql).getByTestId("evaluator-pill-dot")).toHaveStyle({
        backgroundColor: FAILED_COLOR,
      });

      const latency = within(cell).getByTestId("evaluator-pill-eval_latency");
      expect(latency).toHaveTextContent("2.60");
      expect(
        within(latency).queryByTestId("evaluator-pill-dot"),
      ).not.toBeInTheDocument();
    });

    it("reads Pass with a green dot on a scenario the check passed", () => {
      renderTable([
        makeRun({
          results: {
            verdict: Verdict.SUCCESS,
            metCriteria: ["a"],
            unmetCriteria: [],
            evaluations: [sqlPassed],
          },
        }),
      ]);

      const sql = screen.getByTestId("evaluator-pill-eval_sql");
      expect(sql).toHaveTextContent("Pass");
      expect(within(sql).getByTestId("evaluator-pill-dot")).toHaveStyle({
        backgroundColor: PASSED_COLOR,
      });
    });
  });

  describe("given a scenario that left an evaluator nothing to read", () => {
    /** @scenario "A skipped evaluator reads muted on its row" */
    it("reads Skipped, muted, with no dot", () => {
      renderTable([
        makeRun({
          results: {
            verdict: Verdict.SUCCESS,
            metCriteria: ["a"],
            unmetCriteria: [],
            evaluations: [sqlSkipped],
          },
        }),
      ]);

      const sql = screen.getByTestId("evaluator-pill-eval_sql");
      expect(sql).toHaveTextContent("Skipped");
      expect(sql).toHaveAttribute("data-reading", "skipped");
      expect(sql).toHaveStyle({ opacity: "0.7" });
      expect(
        within(sql).queryByTestId("evaluator-pill-dot"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a scenario that ran no evaluator", () => {
    it("leaves the Evaluators cell empty", () => {
      renderTable([makeRun()]);

      expect(
        screen.queryByTestId("run-result-evaluators"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("<LastResultLabel/> with evaluator results", () => {
  afterEach(cleanup);

  describe("given a run that met every criterion and failed a required evaluator", () => {
    /** @scenario "A failed required evaluator names itself beside the verdict of a row" */
    it("reads Failed with the criteria count and names the evaluator on hover", () => {
      render(
        <LastResultLabel
          status={ScenarioRunStatus.FAILED}
          results={{
            metCriteria: ["a", "b", "c"],
            unmetCriteria: [],
            evaluations: [sqlFailed],
          }}
        />,
        { wrapper: Wrapper },
      );

      const label = screen.getByText("Failed (3/3)");
      expect(label.closest("[title]")).toHaveAttribute(
        "title",
        "Failed · SQL Query Equivalence",
      );
    });
  });

  describe("given a run that failed on its criteria alone", () => {
    it("names no evaluator", () => {
      render(
        <LastResultLabel
          status={ScenarioRunStatus.FAILED}
          results={{
            metCriteria: ["a"],
            unmetCriteria: ["b"],
            evaluations: [sqlPassed],
          }}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Failed (1/2)").closest("[title]")).toBeNull();
    });
  });
});

describe("<RunVerdictPanel/> evaluators", () => {
  afterEach(cleanup);

  function renderPanel({
    status = ScenarioRunStatus.SUCCESS,
    metCriteria = ["stays polite", "offers the refund"],
    unmetCriteria = [],
    evaluations = [],
  }: {
    status?: ScenarioRunStatus;
    metCriteria?: string[];
    unmetCriteria?: string[];
    evaluations?: ScenarioEvaluationResult[];
  } = {}) {
    return render(
      <RunVerdictPanel
        status={status}
        metCriteria={metCriteria}
        unmetCriteria={unmetCriteria}
        declaredCriteria={[...metCriteria, ...unmetCriteria]}
        evaluations={evaluations}
      />,
      { wrapper: Wrapper },
    );
  }

  describe("given a finished run that carries evaluator results", () => {
    /** @scenario "The evaluators read under the criteria" */
    it("reads an Evaluators section under the criteria with a row per evaluator", () => {
      renderPanel({
        status: ScenarioRunStatus.FAILED,
        evaluations: [
          sqlFailed,
          makeEvaluation({
            evaluatorId: "eval_pii",
            name: "PII Leak Scanner",
            required: false,
          }),
        ],
      });

      const panel = screen.getByTestId("run-verdict-panel");
      const section = within(panel).getByTestId("run-verdict-evaluators");
      expect(within(section).getByText("Evaluators")).toBeInTheDocument();
      const text = panel.textContent ?? "";
      expect(text.indexOf("Passed criteria")).toBeLessThan(
        text.indexOf("Evaluators"),
      );

      const failedRow = within(section).getByTestId("evaluation-row-eval_sql");
      expect(failedRow).toHaveTextContent("SQL Query Equivalence");
      expect(within(failedRow).getByTestId("evaluation-verdict")).toHaveStyle({
        color: FAILED_COLOR,
      });
      expect(
        within(failedRow).getByTestId("evaluation-verdict"),
      ).toHaveTextContent("Failed");
      expect(failedRow.querySelector("svg.lucide-circle-x")).not.toBeNull();
      expect(
        within(failedRow).getByTestId("evaluation-required-mark"),
      ).toHaveTextContent("Required");

      const passedRow = within(section).getByTestId("evaluation-row-eval_pii");
      expect(within(passedRow).getByTestId("evaluation-verdict")).toHaveStyle({
        color: PASSED_COLOR,
      });
      expect(
        within(passedRow).getByTestId("evaluation-verdict"),
      ).toHaveTextContent("Passed");
      expect(passedRow.querySelector("svg.lucide-circle-check")).not.toBeNull();
      expect(
        within(passedRow).queryByTestId("evaluation-required-mark"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The reason an evaluator gave reads under its verdict" */
    it("reads the explanation in muted text under the verdict word", () => {
      renderPanel({ evaluations: [sqlFailed] });

      const row = screen.getByTestId("evaluation-row-eval_sql");
      const details = within(row).getByTestId("evaluation-details");
      expect(details).toHaveTextContent(
        "Generated SQL filters on fiscal quarter; golden uses calendar quarter",
      );
      expect(details).toHaveStyle({ color: cssVarOfToken("fg.muted") });
      const text = row.textContent ?? "";
      expect(text.indexOf("Failed")).toBeLessThan(
        text.indexOf("Generated SQL"),
      );
    });
  });

  describe("given a finished run that carries no evaluator results", () => {
    /** @scenario "A run without evaluator results shows no Evaluators section" */
    it("draws no Evaluators heading", () => {
      renderPanel();

      expect(screen.queryByText("Evaluators")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("run-verdict-evaluators"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a run whose evaluators include a score", () => {
    /** @scenario "A score evaluator reads its number on its row" */
    it("carries the number where the icons sit and reads no verdict word", () => {
      renderPanel({ evaluations: [latencyScore] });

      const row = screen.getByTestId("evaluation-row-eval_latency");
      expect(
        within(row).getByTestId("evaluation-score-badge"),
      ).toHaveTextContent("2.60");
      expect(
        within(row).queryByTestId("evaluation-verdict"),
      ).not.toBeInTheDocument();
      expect(row.querySelector("svg")).toBeNull();
    });
  });

  describe("given a run on which an evaluator had nothing to read", () => {
    /** @scenario "A skipped evaluator reads muted end to end" */
    it("reads Skipped in muted text with the reason under the name", () => {
      renderPanel({ evaluations: [sqlSkipped] });

      const row = screen.getByTestId("evaluation-row-eval_sql");
      expect(row).toHaveAttribute("data-status", "skipped");
      expect(row).toHaveStyle({ opacity: "0.65" });
      expect(within(row).getByTestId("evaluation-verdict")).toHaveTextContent(
        "Skipped",
      );
      expect(within(row).getByTestId("evaluation-verdict")).toHaveStyle({
        color: cssVarOfToken("fg.muted"),
      });
      expect(within(row).getByTestId("evaluation-details")).toHaveTextContent(
        "no golden_sql on this scenario",
      );
      expect(row.querySelector("svg.lucide-circle-minus")).not.toBeNull();
    });
  });

  describe("given a run that met every criterion and failed a required evaluator", () => {
    /** @scenario "A required evaluator that failed names itself in the verdict line" */
    it("names the evaluator after FAILED on the verdict line", () => {
      renderPanel({
        status: ScenarioRunStatus.FAILED,
        evaluations: [sqlFailed, latencyScore],
      });

      const failed = screen.getByTestId("run-verdict-status-failed");
      expect(failed).toHaveTextContent("FAILED · SQL Query Equivalence");
      expect(
        screen.getByTestId("run-verdict-failed-evaluator"),
      ).toHaveTextContent("SQL Query Equivalence");
    });

    it("keeps FAILED on its own when the run failed on its criteria alone", () => {
      renderPanel({
        status: ScenarioRunStatus.FAILED,
        metCriteria: ["stays polite"],
        unmetCriteria: ["offers the refund"],
        evaluations: [sqlPassed],
      });

      expect(screen.getByTestId("run-verdict-status-failed")).toHaveTextContent(
        /^FAILED$/,
      );
      expect(
        screen.queryByTestId("run-verdict-failed-evaluator"),
      ).not.toBeInTheDocument();
    });

    it("does not name an evaluator that is not required", () => {
      renderPanel({
        status: ScenarioRunStatus.FAILED,
        metCriteria: [],
        unmetCriteria: ["offers the refund"],
        evaluations: [makeEvaluation({ ...sqlFailed, required: false })],
      });

      expect(
        screen.queryByTestId("run-verdict-failed-evaluator"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a run whose evaluator recorded the inputs it read", () => {
    /** @scenario "The inputs an evaluator read are one click away" */
    it("lists each input by name in monospace once Inputs is chosen", async () => {
      const user = userEvent.setup();
      const longValue = `SELECT ${"x, ".repeat(200)}1`;
      renderPanel({
        evaluations: [
          makeEvaluation({
            inputs: {
              output: "SELECT merchant, quarter FROM chargebacks",
              expected_output: longValue,
            },
          }),
        ],
      });

      const row = screen.getByTestId("evaluation-row-eval_sql");
      expect(
        within(row).queryByTestId("evaluation-inputs-eval_sql"),
      ).not.toBeInTheDocument();

      await user.click(
        within(row).getByTestId("evaluation-inputs-toggle-eval_sql"),
      );

      const inputs = within(row).getByTestId("evaluation-inputs-eval_sql");
      expect(within(inputs).getByText("output")).toBeInTheDocument();
      expect(within(inputs).getByText("expected_output")).toBeInTheDocument();
      const short = within(inputs).getByText(
        "SELECT merchant, quarter FROM chargebacks",
      );
      expect(short).toHaveStyle({ fontFamily: "var(--chakra-fonts-mono)" });
      // The long value is cut short on the page and whole in the hover.
      const cut = within(inputs).getByTitle(longValue);
      expect(cut.textContent?.length).toBeLessThan(longValue.length);
      expect(cut.textContent?.endsWith("…")).toBe(true);
    });
  });
});
