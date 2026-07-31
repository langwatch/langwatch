/**
 * Unit tests for producing a report end to end.
 *
 * The model is stubbed rather than called. What is under test is the promise
 * the service makes regardless of what a model does: the figures always come
 * out, the tier names honestly how much of the report survived, and nothing
 * a model can return turns a report into a failed download.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countRunOutcomes,
  passRateFrom,
} from "~/server/scenarios/run-outcome-summary";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  BatchRunNotFoundError,
  BatchRunReportService,
} from "../batch-run-report.service";
import type { BatchRunReportReader } from "../reader";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

const generateObjectMock = vi.mocked(generateObject);
const GENERATED_AT = "2026-07-29T12:00:00.000Z";

function makeRun({
  runId,
  status,
  unmetCriteria = [],
  metCriteria = [],
}: {
  runId: string;
  status: ScenarioRunStatus;
  unmetCriteria?: string[];
  metCriteria?: string[];
}): ScenarioRunData {
  return {
    scenarioId: `scen_${runId}`,
    batchRunId: "batch_1",
    scenarioRunId: runId,
    name: `Scenario ${runId}`,
    description: null,
    metadata: null,
    status,
    results: {
      verdict:
        status === ScenarioRunStatus.SUCCESS
          ? Verdict.SUCCESS
          : Verdict.FAILURE,
      metCriteria,
      unmetCriteria,
    },
    messages: [
      { id: "m1", role: "user", content: "hello" },
      { id: "m2", role: "assistant", content: "hi" },
    ] as never,
    timestamp: 1_700_000_000_000,
    durationInMs: 1_000,
  };
}

const DEFAULT_RUNS = [
  makeRun({
    runId: "run_pass",
    status: ScenarioRunStatus.SUCCESS,
    metCriteria: ["answers the question"],
  }),
  makeRun({
    runId: "run_fail",
    status: ScenarioRunStatus.FAILED,
    unmetCriteria: ["stays polite"],
  }),
];

function makeReader(
  runs: ScenarioRunData[] = DEFAULT_RUNS,
): BatchRunReportReader {
  return {
    getRunDataForBatchRun: async () => ({
      changed: true as const,
      lastUpdatedAt: 1,
      runs,
    }),
    getBatchHistoryForScenarioSet: async () => ({
      batches: [],
      hasMore: false,
      lastUpdatedAt: 0,
      totalCount: 0,
    }),
    findRunOutcomesForBatchIds: async () => [],
  };
}

function makeService({
  runs = DEFAULT_RUNS,
  resolveModel = async () => ({}) as never,
}: {
  runs?: ScenarioRunData[];
  resolveModel?: () => Promise<never>;
} = {}) {
  return BatchRunReportService.create({
    reader: makeReader(runs),
    resolveModel,
  });
}

function generate(service: ReturnType<typeof makeService>) {
  return service.generate({
    request: {
      projectId: "project_1",
      scenarioSetId: "set_1",
      batchRunId: "batch_1",
      suiteName: "Checkout suite",
      withAnalysis: true,
    },
    generatedAt: GENERATED_AT,
  });
}

/** A draft citing a run that really exists, so it survives resolution. */
const VALID_DRAFT = {
  answers: [
    {
      questionId: "past.outcome",
      declined: false,
      statements: [
        {
          text: "One scenario failed on politeness.",
          citations: [{ kind: "run", runId: "run_fail" }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("BatchRunReportService.generate() history", () => {
  /**
   * The history comes back newest first, so taking a window of it hands the
   * trend the set's latest runs whichever run is being reported on. Exporting
   * an older run then compares it against its own future and reverses every
   * verdict a reader acts on: a criterion that only starts passing later shows
   * as a regression against it.
   */
  describe("given later runs exist in the same set", () => {
    const RUN_AT = 1_700_000_000_000;
    let requestedBatchIds: string[] = [];
    let requestedLimits: number[] = [];

    function readerWithHistory(): BatchRunReportReader {
      return {
        getRunDataForBatchRun: async () => ({
          changed: true as const,
          lastUpdatedAt: 1,
          runs: DEFAULT_RUNS.map((run) => ({ ...run, timestamp: RUN_AT })),
        }),
        getBatchHistoryForScenarioSet: async ({ limit }: { limit: number }) => {
          requestedLimits.push(limit);
          return {
            batches: [
              { batchRunId: "batch_after", lastRunAt: RUN_AT + 60_000 },
              { batchRunId: "batch_1", lastRunAt: RUN_AT },
              { batchRunId: "batch_before", lastRunAt: RUN_AT - 60_000 },
            ],
            hasMore: false,
            lastUpdatedAt: 0,
            totalCount: 3,
          };
        },
        findRunOutcomesForBatchIds: async ({
          batchRunIds,
        }: {
          batchRunIds: string[];
        }) => {
          requestedBatchIds = batchRunIds;
          return [];
        },
      } as unknown as BatchRunReportReader;
    }

    /**
     * Nearly every export is of the newest run, where the window is enough.
     * Asking for the repository's maximum page regardless materialised most of
     * a page in order to discard it, before the user is shown anything.
     */
    it("reads narrow when the run being reported is the newest", async () => {
      requestedLimits = [];
      generateObjectMock.mockRejectedValue(new Error("no model"));

      await generate(
        BatchRunReportService.create({
          reader: readerWithHistory(),
          resolveModel: async () => ({}) as never,
        }),
      );

      expect(requestedLimits).toEqual([20]);
    });

    /** @scenario A run is only ever compared against runs that preceded it */
    it("compares only against runs that came before it", async () => {
      requestedBatchIds = [];
      generateObjectMock.mockRejectedValue(new Error("no model"));

      await generate(
        BatchRunReportService.create({
          reader: readerWithHistory(),
          resolveModel: async () => ({}) as never,
        }),
      );

      expect(requestedBatchIds).toEqual(["batch_before"]);
      expect(requestedBatchIds).not.toContain("batch_after");
      expect(requestedBatchIds).not.toContain("batch_1");
    });
  });
});

describe("BatchRunReportService.generate() without the analysis", () => {
  describe("when the analysis was not asked for", () => {
    /** @scenario I can take the figures without waiting for the analysis */
    it("produces the figures without calling a model at all", async () => {
      const service = makeService();

      const model = await service.generate({
        request: {
          projectId: "project_1",
          scenarioSetId: "set_1",
          batchRunId: "batch_1",
          suiteName: "Checkout suite",
          withAnalysis: false,
        },
        generatedAt: GENERATED_AT,
      });

      expect(generateObjectMock).not.toHaveBeenCalled();
      expect(model.tier).toBe("figures_only");
      expect(model.headline.counts.totalCount).toBe(2);
      expect(
        model.sections.find((it) => it.questionId === "past.outcome")?.computed
          .length,
      ).toBeGreaterThan(0);
    });

    /** @scenario A report exported without the analysis does not read as a failure */
    it("records the choice so the report does not report a failure", async () => {
      const model = await makeService().generate({
        request: {
          projectId: "project_1",
          scenarioSetId: "set_1",
          batchRunId: "batch_1",
          suiteName: "Checkout suite",
          withAnalysis: false,
        },
        generatedAt: GENERATED_AT,
      });

      expect(model.meta.withAnalysis).toBe(false);
      expect(model.integrity.notes.join(" ")).toContain("without Langy");

      // The questions only Langy can answer should point at how to get them
      // answered, not report an outage nobody caused.
      const gaps = model.sections
        .filter((it) => it.questionId.startsWith("future."))
        .map((it) => it.gap ?? "");
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) {
        expect(gap).toContain("Export this run again with Langy");
        expect(gap).not.toContain("was not available");
      }
    });
  });
});

describe("BatchRunReportService.generate() degradation", () => {
  describe("when no model is configured", () => {
    /** @scenario A report still downloads when no model is configured */
    it("produces the figures and names the tier honestly", async () => {
      const service = makeService({
        resolveModel: async () => {
          throw new Error("ModelNotConfigured");
        },
      });

      const model = await generate(service);

      expect(model.tier).toBe("figures_only");
      expect(model.sections.length).toBeGreaterThan(0);
      expect(
        model.sections.find((it) => it.questionId === "past.outcome")?.computed
          .length,
      ).toBeGreaterThan(0);
      expect(model.integrity.notes.join(" ")).toContain("figures only");
    });
  });

  describe("when the analysis fails but the run is fine", () => {
    /** @scenario A report still downloads when the analysis fails */
    it("still returns a report", async () => {
      generateObjectMock.mockRejectedValue(new Error("provider exploded"));

      const model = await generate(makeService());

      expect(model.tier).toBe("figures_only");
      expect(model.headline.counts.totalCount).toBe(2);
    });
  });

  describe("when the analysis succeeds but the check fails", () => {
    /** @scenario A report still downloads when the check fails */
    it("keeps the writing and says it was not checked", async () => {
      generateObjectMock
        .mockResolvedValueOnce({ object: VALID_DRAFT } as never)
        .mockRejectedValueOnce(new Error("checker exploded"));

      const model = await generate(makeService());

      expect(model.tier).toBe("unchecked");
      expect(model.integrity.notes.join(" ")).toContain(
        "could not be checked a second time",
      );
    });
  });

  describe("when the check comes back almost empty", () => {
    /** @scenario A check that came back mostly empty is discarded rather than obeyed */
    it("keeps the statements rather than emptying the report", async () => {
      generateObjectMock
        .mockResolvedValueOnce({ object: VALID_DRAFT } as never)
        .mockResolvedValueOnce({ object: { verdicts: [] } } as never);

      const model = await generate(makeService());

      expect(model.tier).toBe("unchecked");
      const written = model.sections.find(
        (it) => it.questionId === "past.outcome",
      )?.written;
      expect(written?.length).toBeGreaterThan(0);
    });
  });

  describe("when both passes succeed", () => {
    it("reports the verified tier", async () => {
      generateObjectMock
        .mockResolvedValueOnce({ object: VALID_DRAFT } as never)
        .mockResolvedValueOnce({
          object: {
            verdicts: [{ claimId: "past.outcome#0", supported: true }],
          },
        } as never);

      const model = await generate(makeService());

      expect(model.tier).toBe("verified");
    });
  });
});

describe("BatchRunReportService.generate() figures", () => {
  describe("when the run has no scenarios", () => {
    /** @scenario Asking for a run that does not exist is refused */
    it("refuses rather than producing an empty report", async () => {
      await expect(generate(makeService({ runs: [] }))).rejects.toBeInstanceOf(
        BatchRunNotFoundError,
      );
    });
  });

  describe("given the run history's own arithmetic", () => {
    /** @scenario The report never disagrees with the screen */
    it("reports the pass rate the canonical calculation produces", async () => {
      generateObjectMock.mockRejectedValue(new Error("no model"));

      const model = await generate(makeService());
      const expected = passRateFrom({
        counts: countRunOutcomes({
          statuses: DEFAULT_RUNS.map((run) => run.status),
        }),
      });

      expect(model.headline.passRate.value).toBe(expected);
    });

    /** @scenario A small sample is reported as a small sample */
    it("flags a two-scenario run as too small to conclude from", async () => {
      generateObjectMock.mockRejectedValue(new Error("no model"));

      const model = await generate(makeService());

      expect(model.headline.passRate.isTooFewToConclude).toBe(true);
    });
  });

  describe("given a scenario that stopped reporting", () => {
    /** @scenario A run shown as stalled is reported as stalled */
    it("counts it as stalled rather than as still running", async () => {
      generateObjectMock.mockRejectedValue(new Error("no model"));
      const service = makeService({
        runs: [
          ...DEFAULT_RUNS,
          makeRun({ runId: "run_stalled", status: ScenarioRunStatus.STALLED }),
        ],
      });

      const model = await generate(service);

      expect(model.headline.counts.stalledCount).toBe(1);
      expect(model.headline.counts.inProgressCount).toBe(0);
      // A stalled run did not pass, so it belongs in the denominator.
      expect(model.headline.counts.settledCount).toBe(3);
    });
  });

  describe("when the same unchanged run is reported twice", () => {
    /** @scenario The same run produces the same report twice */
    it("produces an identical model", async () => {
      generateObjectMock.mockRejectedValue(new Error("no model"));

      const first = await generate(makeService());
      const second = await generate(makeService());

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });
});
