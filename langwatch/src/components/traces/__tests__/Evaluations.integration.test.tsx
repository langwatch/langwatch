/**
 * @vitest-environment jsdom
 *
 * Integration tests for Evaluations, Guardrails, and EvaluationsCount components
 * with evaluation history grouping.
 *
 * Tests that evaluations are grouped by evaluator_id, showing only the latest
 * result by default with a history indicator for groups with multiple runs.
 *
 * @see specs/traces/evaluation-history-grouping.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ElasticSearchEvaluation } from "../../../server/tracer/types";
import { Evaluations, Guardrails, EvaluationsCount } from "../Evaluations";

// Mock next/router used by EvaluationStatusItem
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
  }),
}));

// Mock hooks used by EvaluationStatusItem
vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

// Mock evaluator definitions (generated file may not exist in test env)
vi.mock("../../../server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {},
}));

vi.mock("../../../server/evaluations/getEvaluator", () => ({
  getEvaluatorDefinitions: () => null,
}));

// Mock tRPC api used by EvaluationStatusItem
vi.mock("../../../utils/api", () => ({
  api: {
    evaluators: {
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    monitors: {
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeEvaluation(
  overrides: Partial<ElasticSearchEvaluation>,
): ElasticSearchEvaluation {
  return {
    evaluation_id: "eval_default",
    evaluator_id: "evaluator_default",
    name: "Test Evaluator",
    status: "processed",
    passed: true,
    score: 0.9,
    timestamps: {
      finished_at: Date.now(),
    },
    ...overrides,
  } as ElasticSearchEvaluation;
}

const traceBase = {
  project: {
    id: "proj_1",
    slug: "test-project",
    name: "Test Project",
  } as any,
  traceId: "trace_1",
};

describe("<Evaluations/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when an evaluator has multiple runs", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.3,
        passed: false,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.8,
        passed: true,
        timestamps: { finished_at: 2000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_3",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.95,
        passed: true,
        timestamps: { finished_at: 3000 },
      }),
    ];

    it("displays a single entry for the evaluator", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      const nameElements = screen.getAllByText("Toxicity Check");
      // Only the latest should be visible by default (not 3 entries)
      expect(nameElements).toHaveLength(1);
    });

    it("displays the score from the most recent run", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      // The latest run has score 0.95
      expect(screen.getByText("0.95")).toBeInTheDocument();
      // The older scores should not be visible
      expect(screen.queryByText("0.3")).not.toBeInTheDocument();
      expect(screen.queryByText("0.8")).not.toBeInTheDocument();
    });

    it("shows a history indicator with the count of previous runs", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("+2 previous")).toBeInTheDocument();
    });
  });

  describe("when an evaluator has a single run", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "pii_detection",
        name: "PII Detection",
        score: 1.0,
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
    ];

    it("displays the entry without a history indicator", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("PII Detection")).toBeInTheDocument();
      expect(screen.queryByText(/previous/)).not.toBeInTheDocument();
    });
  });

  describe("when there are multiple evaluators with history", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.3,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.95,
        timestamps: { finished_at: 3000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_3",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.8,
        timestamps: { finished_at: 2000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_4",
        evaluator_id: "faithfulness",
        name: "Faithfulness",
        score: 0.7,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_5",
        evaluator_id: "faithfulness",
        name: "Faithfulness",
        score: 0.9,
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("displays separate entries for each evaluator", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Toxicity Check")).toBeInTheDocument();
      expect(screen.getByText("Faithfulness")).toBeInTheDocument();
    });

    it("shows independent history indicators for each evaluator", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      // Toxicity has 3 runs -> +2 previous
      // Faithfulness has 2 runs -> +1 previous
      expect(screen.getByText("+2 previous")).toBeInTheDocument();
      expect(screen.getByText("+1 previous")).toBeInTheDocument();
    });
  });

  describe("when evaluations have no evaluator_id", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: undefined as unknown as string,
        name: "Custom Eval A",
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: undefined as unknown as string,
        name: "Custom Eval B",
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("displays each as an individual entry", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Custom Eval A")).toBeInTheDocument();
      expect(screen.getByText("Custom Eval B")).toBeInTheDocument();
    });

    it("shows no history indicator", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/previous/)).not.toBeInTheDocument();
    });
  });

  describe("when list keys would otherwise collide", () => {
    it("renders grouped and ungrouped entries without duplicate key warnings", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_x",
          evaluator_id: undefined as unknown as string,
          name: "Ungrouped A",
          timestamps: { finished_at: 4000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_y",
          evaluator_id: undefined as unknown as string,
          name: "Ungrouped B",
          timestamps: { finished_at: 3000 },
        }),
        makeEvaluation({
          evaluation_id: "c",
          evaluator_id: "a-b",
          name: "Grouped A-B",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "b-c",
          evaluator_id: "a",
          name: "Grouped A",
          timestamps: { finished_at: 1000 },
        }),
      ];

      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Ungrouped A")).toBeInTheDocument();
      expect(screen.getByText("Ungrouped B")).toBeInTheDocument();
      expect(screen.getByText("Grouped A-B")).toBeInTheDocument();
      expect(screen.getByText("Grouped A")).toBeInTheDocument();

      const hasDuplicateKeyWarning = consoleErrorSpy.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("Encountered two children with the same key"),
      );

      expect(hasDuplicateKeyWarning).toBe(false);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("when expanding history", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.3,
        passed: false,
        status: "processed",
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.8,
        passed: true,
        status: "processed",
        timestamps: { finished_at: 2000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_3",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        score: 0.95,
        passed: true,
        status: "processed",
        timestamps: { finished_at: 3000 },
      }),
    ];

    it("shows all runs when the history indicator is clicked", async () => {
      const user = userEvent.setup();

      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      // Initially only latest score is shown
      expect(screen.getByText("0.95")).toBeInTheDocument();
      expect(screen.queryByText("0.8")).not.toBeInTheDocument();
      expect(screen.queryByText("0.3")).not.toBeInTheDocument();

      // Click the history indicator
      await user.click(screen.getByText("+2 previous"));

      // All scores should now be visible
      expect(screen.getByText("0.95")).toBeInTheDocument();
      expect(screen.getByText("0.8")).toBeInTheDocument();
      expect(screen.getByText("0.3")).toBeInTheDocument();
    });

    it("collapses previous runs when the indicator is clicked again", async () => {
      const user = userEvent.setup();

      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      // Expand
      await user.click(screen.getByText("+2 previous"));
      expect(screen.getByText("0.8")).toBeInTheDocument();

      // Collapse
      await user.click(screen.getByText("+2 previous"));
      expect(screen.queryByText("0.8")).not.toBeInTheDocument();
      expect(screen.queryByText("0.3")).not.toBeInTheDocument();
    });
  });

  describe("when the latest run has error status", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        score: 0.8,
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "error",
        error: { has_error: true as const, message: "Timeout occurred", stacktrace: [] },
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("shows the error state for the latest entry", () => {
      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("shows the previous successful run when expanded", async () => {
      const user = userEvent.setup();

      render(
        <Evaluations
          {...traceBase}
          evaluations={evaluations}
          anyGuardrails={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("+1 previous"));

      expect(screen.getByText("0.8")).toBeInTheDocument();
    });
  });
});

describe("<Guardrails/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a guardrail evaluator has multiple runs", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "content_filter",
        name: "Content Filter",
        is_guardrail: true,
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "content_filter",
        name: "Content Filter",
        is_guardrail: true,
        passed: true,
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("shows a single grouped entry with history indicator", () => {
      render(
        <Guardrails {...traceBase} evaluations={evaluations} />,
        { wrapper: Wrapper },
      );

      const nameElements = screen.getAllByText("Content Filter");
      expect(nameElements).toHaveLength(1);
      expect(screen.getByText("+1 previous")).toBeInTheDocument();
    });
  });
});

describe("<EvaluationsCount/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when counting evaluations with multiple runs per evaluator", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 2000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_3",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 3000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_4",
        evaluator_id: "faithfulness",
        name: "Faithfulness",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
    ];

    it("counts unique evaluators not individual runs", () => {
      render(
        <EvaluationsCount {...traceBase} evaluations={evaluations} />,
        { wrapper: Wrapper },
      );

      // 2 unique evaluators (toxicity + faithfulness), not 4 individual runs
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("when the latest run of an evaluator has failed", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: false,
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("counts based on the latest run status", () => {
      render(
        <EvaluationsCount {...traceBase} evaluations={evaluations} />,
        { wrapper: Wrapper },
      );

      // The latest run failed, so count is "1 failed"
      expect(screen.getByText("1 failed")).toBeInTheDocument();
    });
  });

  describe("when the latest run passed but an older run failed", () => {
    const evaluations: ElasticSearchEvaluation[] = [
      makeEvaluation({
        evaluation_id: "eval_1",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: false,
        timestamps: { finished_at: 1000 },
      }),
      makeEvaluation({
        evaluation_id: "eval_2",
        evaluator_id: "toxicity",
        name: "Toxicity Check",
        status: "processed",
        passed: true,
        timestamps: { finished_at: 2000 },
      }),
    ];

    it("does not count as failed since the latest run passed", () => {
      render(
        <EvaluationsCount {...traceBase} evaluations={evaluations} />,
        { wrapper: Wrapper },
      );

      // Latest run passed, so should show green count "1", not "1 failed"
      expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });
});
