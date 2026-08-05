// @vitest-environment jsdom
/**
 * The ComparisonCharts glue layer for the judge-vs-reviewer confusion matrix:
 * which (target, evaluator) pairings are offered a card at all.
 *
 * This layer is where the feature's wiring bugs have actually lived (duplicate
 * card keys when the id dropped the target, the truncation cap dividing by
 * candidate count instead of target count), and none of the compute-layer
 * tests can reach it — they start after the pairing decisions are made.
 *
 * @see specs/experiments/judge-annotation-confusion-matrix.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ComparisonCharts reads the leaderboard rollout flag, which reaches for the
// organization context and tRPC. Neither is mounted here, and none of these
// tests are about the leaderboard.
vi.mock("../useShowComparisonLeaderboard", () => ({
  useShowComparisonLeaderboard: () => false,
}));

// One stable result array per test, assigned before render and never
// reassigned within a test: useAnnotationsByTraceIds memoises on the results'
// content signature, and downstream memo chains feed a setState effect — an
// unstable array here reproduces the render loop the shared fixture exists to
// avoid (see ~/test-utils/stableEmptyQueryResults.ts).
const mocks = vi.hoisted(() => ({
  queryResults: [] as unknown[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: vi.fn(() => mocks.queryResults),
  },
}));

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { ComparisonCharts } from "../ComparisonCharts";
import type {
  BatchComparisonColumn,
  BatchEvaluatorResult,
  BatchResultRow,
  ComparisonRunData,
} from "../types";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const TARGETS = [
  { id: "target-1", name: "support-agent" },
  { id: "target-2", name: "billing-agent" },
];

const traceIdFor = ({ targetId, index }: { targetId: string; index: number }) =>
  `trace-${targetId}-${index}`;

const makeRows = ({
  count,
  evaluators,
}: {
  count: number;
  evaluators: { evaluatorId: string; evaluatorName: string }[];
}): BatchResultRow[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    datasetEntry: { input: `input ${index}` },
    targets: Object.fromEntries(
      TARGETS.map((target) => [
        target.id,
        {
          targetId: target.id,
          output: { output: `response ${index}` },
          cost: 0.001,
          duration: 100,
          error: null,
          traceId: traceIdFor({ targetId: target.id, index }),
          evaluatorResults: evaluators.map(
            ({ evaluatorId, evaluatorName }): BatchEvaluatorResult => ({
              evaluatorId,
              evaluatorName,
              status: "processed",
              score: null,
              passed: index % 2 === 0,
            }),
          ),
        },
      ]),
    ),
  }));

const makeRunData = ({
  runId,
  rows,
}: {
  runId: string;
  rows: BatchResultRow[];
}): ComparisonRunData => ({
  runId,
  runName: runId,
  color: "#3182ce",
  isLoading: false,
  data: {
    runId,
    experimentId: "exp-1",
    projectId: "project-1",
    createdAt: Date.now(),
    datasetColumns: [{ name: "input", hasImages: false }],
    targetColumns: TARGETS.map((target) => ({
      id: target.id,
      name: target.name,
      type: "prompt" as const,
      outputFields: ["output"],
      metadata: {},
    })),
    evaluatorIds: [],
    evaluatorNames: {},
    rows,
  },
});

/** One agreeing thumbs-up per trace of the first `annotatedRowCount` rows. */
const annotateRows = ({
  annotatedRowCount,
}: {
  annotatedRowCount: number;
}): AnnotationByTrace[] =>
  TARGETS.flatMap((target) =>
    Array.from(
      { length: annotatedRowCount },
      (_, index) =>
        ({
          id: `annotation-${target.id}-${index}`,
          traceId: traceIdFor({ targetId: target.id, index }),
          isThumbsUp: true,
          comment: null,
        }) as AnnotationByTrace,
    ),
  );

const setFetchedAnnotations = (annotations: AnnotationByTrace[]) => {
  mocks.queryResults = [
    { data: annotations, dataUpdatedAt: 1, status: "success" },
  ];
};

const EXACT_MATCH = {
  evaluatorId: "exact_match",
  evaluatorName: "Exact Match",
};
const ANSWER_MATCH = {
  evaluatorId: "llm_answer_match",
  evaluatorName: "LLM Answer Match",
};

const renderCharts = ({
  comparisonData,
  showConfusionMatrix,
  comparisonColumns,
}: {
  comparisonData: ComparisonRunData[];
  showConfusionMatrix?: boolean;
  comparisonColumns?: BatchComparisonColumn[];
}) =>
  render(
    <ComparisonCharts
      comparisonData={comparisonData}
      isVisible={true}
      showConfusionMatrix={showConfusionMatrix}
      comparisonColumns={comparisonColumns}
    />,
    { wrapper: Wrapper },
  );

describe("ComparisonCharts confusion matrix availability", () => {
  afterEach(() => {
    cleanup();
    mocks.queryResults = [];
    // The mocked `api.useQueries` runs on every render; its call history
    // retains render-scoped closures until cleared (same reasoning as
    // ComparisonCharts.test.tsx).
    vi.clearAllMocks();
  });

  describe("given a run whose annotation coverage meets the floor", () => {
    const runWithCoverage = () => {
      setFetchedAnnotations(annotateRows({ annotatedRowCount: 5 }));
      return [
        makeRunData({
          runId: "run-1",
          rows: makeRows({ count: 8, evaluators: [EXACT_MATCH] }),
        }),
      ];
    };

    describe("when the feature is not enabled", () => {
      /** @scenario Feature flag gates the whole surface */
      it("offers no confusion-matrix card regardless of coverage", () => {
        renderCharts({
          comparisonData: runWithCoverage(),
          showConfusionMatrix: false,
        });

        expect(screen.queryByText(/vs reviewers/)).toBeNull();
      });
    });

    describe("when the feature is enabled", () => {
      /** @scenario Confusion matrix mounts once the annotation floor is met */
      it("offers one card per target, each naming its target", () => {
        renderCharts({
          comparisonData: runWithCoverage(),
          showConfusionMatrix: true,
        });

        // The same judge scores both targets, so only the target name keeps
        // the sibling cards tellable apart — the regression here was two
        // identically-keyed, identically-titled cards.
        expect(
          screen.getByText("Exact Match vs reviewers — support-agent"),
        ).toBeDefined();
        expect(
          screen.getByText("Exact Match vs reviewers — billing-agent"),
        ).toBeDefined();
      });

      /** @scenario Each pass/fail evaluator with enough annotation coverage gets its own matrix */
      it("offers a separate card for each pass/fail evaluator", () => {
        setFetchedAnnotations(annotateRows({ annotatedRowCount: 5 }));
        renderCharts({
          comparisonData: [
            makeRunData({
              runId: "run-1",
              rows: makeRows({
                count: 8,
                evaluators: [EXACT_MATCH, ANSWER_MATCH],
              }),
            }),
          ],
          showConfusionMatrix: true,
        });

        expect(
          screen.getByText("Exact Match vs reviewers — support-agent"),
        ).toBeDefined();
        expect(
          screen.getByText("LLM Answer Match vs reviewers — support-agent"),
        ).toBeDefined();
      });
    });

    describe("when the run's evaluator is a Comparison judge", () => {
      /** @scenario Comparison evaluators are not offered a confusion matrix */
      it("excludes it even though its results carry pass/fail verdicts", () => {
        setFetchedAnnotations(annotateRows({ annotatedRowCount: 5 }));
        renderCharts({
          comparisonData: [
            makeRunData({
              runId: "run-1",
              rows: makeRows({
                count: 8,
                evaluators: [
                  { evaluatorId: "comparison", evaluatorName: "Comparison" },
                  EXACT_MATCH,
                ],
              }),
            }),
          ],
          showConfusionMatrix: true,
          comparisonColumns: [
            {
              evaluatorId: "comparison",
              name: "Comparison",
              variants: [{ id: "target-1", name: "support-agent" }],
              verdictsByRow: {},
            },
          ],
        });

        expect(screen.queryByText(/^Comparison vs reviewers/)).toBeNull();
        expect(
          screen.getByText("Exact Match vs reviewers — support-agent"),
        ).toBeDefined();
      });
    });

    describe("when several runs are being compared", () => {
      /** @scenario No confusion matrix is offered when comparing multiple runs */
      it("offers no card — the matrix scores one run at a time", () => {
        setFetchedAnnotations(annotateRows({ annotatedRowCount: 5 }));
        renderCharts({
          comparisonData: [
            makeRunData({
              runId: "run-1",
              rows: makeRows({ count: 8, evaluators: [EXACT_MATCH] }),
            }),
            makeRunData({
              runId: "run-2",
              rows: makeRows({ count: 8, evaluators: [EXACT_MATCH] }),
            }),
          ],
          showConfusionMatrix: true,
        });

        expect(screen.queryByText(/vs reviewers/)).toBeNull();
      });
    });
  });

  describe("given fewer annotated rows than the mount floor", () => {
    /** @scenario Confusion matrix mounts only once enough rows are annotated */
    it("offers no card below 5 annotated rows", () => {
      setFetchedAnnotations(annotateRows({ annotatedRowCount: 4 }));
      renderCharts({
        comparisonData: [
          makeRunData({
            runId: "run-1",
            rows: makeRows({ count: 8, evaluators: [EXACT_MATCH] }),
          }),
        ],
        showConfusionMatrix: true,
      });

      expect(screen.queryByText(/vs reviewers/)).toBeNull();
    });
  });
});
