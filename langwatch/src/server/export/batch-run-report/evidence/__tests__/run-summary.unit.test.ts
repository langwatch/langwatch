/**
 * Unit tests for the reading a report opens with.
 *
 * This card is written for someone who is told about the run rather than
 * running it, so the tests are about what it refuses to imply: no verdict on an
 * agent that never got to answer, no movement claimed from noise, and no run
 * ids, which answer none of the questions it exists to answer.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import { evidenceFixture } from "../../__tests__/evidence-fixture";
import { buildRunSummary } from "../run-summary";

function summaryOf(overrides: Parameters<typeof evidenceFixture>[0] = {}) {
  return buildRunSummary({ evidence: evidenceFixture(overrides) });
}

describe("the run summary", () => {
  describe("given a run where most scenarios never reached a verdict", () => {
    const summary = summaryOf({
      counts: {
        passedCount: 1,
        failedCount: 3,
        stalledCount: 0,
        cancelledCount: 0,
        inProgressCount: 0,
        queuedCount: 0,
        completedCount: 4,
        settledCount: 4,
        totalCount: 4,
      },
      signatures: [
        {
          signatureId: "s_err",
          kind: "errored",
          unmetCriterionIds: [],
          errorShape: "<shape>",
          errorExample: "AI_APICallError: content was flagged",
          runIds: ["run_1", "run_2", "run_3"],
          scenarioIds: ["scen_1", "scen_2", "scen_3"],
        },
      ],
    });

    /**
     * The failure this guards against is silent: a mostly-errored run still
     * produces a pass rate, and that rate reads as a judgement on the agent
     * when the agent was never asked anything.
     *
     * @scenario The summary says when a run cannot judge the agent
     */
    it("says the run did not get far enough to judge the agent", () => {
      expect(summary.verdict).toContain("never got far enough");
      expect(summary.tone).toBe("warn");
    });

    /** @scenario The summary says when a run cannot judge the agent */
    it("warns that the figures describe the run, not the agent", () => {
      expect(summary.caveat).toContain("never reached a verdict");
      expect(summary.caveat).toContain("not of the agent");
    });
  });

  describe("given a criterion that used to hold and now fails", () => {
    /** @scenario The summary leads with the thing most worth fixing */
    it("leads with the regression rather than the count", () => {
      const summary = summaryOf({
        trend: [
          {
            criterionId: "c_known",
            scenarioId: "scen_1",
            text: "stays polite",
            classification: "regression",
            currentOutcome: "unmet",
            history: [],
            streakBatches: 1,
          },
        ],
      });

      expect(summary.verdict).toContain("stopped working");
      expect(summary.topProblem).toContain("stays polite");
    });
  });

  describe("given a run where nothing failed", () => {
    /** @scenario The summary leads with the thing most worth fixing */
    it("says so plainly and in a passing tone", () => {
      const summary = summaryOf({
        counts: {
          passedCount: 2,
          failedCount: 0,
          stalledCount: 0,
          cancelledCount: 0,
          inProgressCount: 0,
          queuedCount: 0,
          completedCount: 2,
          settledCount: 2,
          totalCount: 2,
        },
        signatures: [],
      });

      expect(summary.verdict).toContain("Everything passed");
      expect(summary.tone).toBe("pass");
    });
  });
});

describe("the run summary's movement", () => {
  function movementFor(previousRate: number | null): string | null {
    return summaryOf({
      priorBatches:
        previousRate === null
          ? []
          : [
              {
                batchRunId: "b1",
                startedAt: 1,
                passRate: previousRate,
                settled: 5,
              },
            ],
    }).movement;
  }

  /** @scenario The summary says which way the run moved */
  it("names the direction and size of a real change", () => {
    // The fixture's own rate is 50%.
    expect(movementFor(85)).toContain("down 35 points");
    expect(movementFor(20)).toContain("up 30 points");
  });

  /** @scenario The summary says which way the run moved */
  it("calls a small change no change rather than dressing it as movement", () => {
    expect(movementFor(52)).toContain("About the same");
  });

  /** @scenario The first run of a suite reports no trend */
  it("says nothing when there is no earlier run to compare with", () => {
    expect(movementFor(null)).toBeNull();
  });
});

describe("the run summary's audience", () => {
  /**
   * Written for people for whom an identifier answers nothing. A run id in
   * here is a sign the summary has drifted back into being a debugging aid.
   *
   * @scenario The summary is readable without knowing the system
   */
  it("never names a run id", () => {
    const summary = summaryOf();
    const prose = [
      summary.verdict,
      summary.movement,
      summary.topProblem,
      summary.caveat,
    ]
      .filter(Boolean)
      .join(" ");

    expect(prose).not.toContain("run_");
    expect(prose).not.toContain("batch_");
  });

  /** @scenario The summary is readable without knowing the system */
  it("gives the scale and price of the run", () => {
    const labels = summaryOf().facts.map((fact) => fact.label);

    expect(labels).toContain("Scenarios");
    expect(labels).toContain("Took");
  });
});
