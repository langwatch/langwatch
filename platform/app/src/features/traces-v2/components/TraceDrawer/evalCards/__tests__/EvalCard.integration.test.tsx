/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the lazy-loaded evaluator inputs in EvalCard.
 * Renders the real card tree and only mocks the boundaries: the tRPC query
 * that fetches a single evaluation's inputs, the drawer store (trace id), and
 * the org/project hook.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const getEvaluationInputsUseQueryMock = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getEvaluationInputs: { useQuery: getEvaluationInputsUseQueryMock },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_test" },
    organization: {},
    team: undefined,
    isFetching: false,
  }),
}));

import { EvalCard } from "../EvalCard";
import type { EvalEntry } from "../utils";

function renderCard(eval_: EvalEntry) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EvalCard eval_={eval_} />
    </ChakraProvider>,
  );
}

const baseEval: EvalEntry = {
  name: "Toxicity",
  score: true,
  scoreType: "boolean",
  status: "pass",
  evaluationId: "eval-1",
};

afterEach(() => {
  cleanup();
});

describe("EvalCard evaluator inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an evaluation whose inputs were not loaded with the verdict list", () => {
    describe("when the card's details are expanded", () => {
      /** @scenario Inputs load on demand when an evaluation is expanded */
      it("fetches inputs for that single evaluation and shows them", () => {
        // The lazy query only returns data when enabled (panel open).
        getEvaluationInputsUseQueryMock.mockImplementation(
          (_input: unknown, opts: { enabled?: boolean }) => ({
            data: opts?.enabled
              ? { input: "the prompt", output: "the reply" }
              : undefined,
            isLoading: false,
          }),
        );

        renderCard(baseEval); // no `inputs` on the entry

        // Collapsed: the lazy fetch is disabled (nothing shipped on open).
        expect(getEvaluationInputsUseQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({ evaluationId: "eval-1" }),
          expect.objectContaining({ enabled: false }),
        );
        expect(screen.queryByText("the prompt")).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("Show details"));

        // Expanded: the fetch is enabled and the inputs render. The read is
        // keyed by evaluationId and authorized at the project level (no
        // trace-scoped public-share path), so no traceId is sent.
        expect(getEvaluationInputsUseQueryMock).toHaveBeenLastCalledWith(
          expect.objectContaining({
            projectId: "project_test",
            evaluationId: "eval-1",
          }),
          expect.objectContaining({ enabled: true }),
        );
        expect(screen.getByText("input")).toBeInTheDocument();
        expect(screen.getByText("the prompt")).toBeInTheDocument();
      });
    });
  });

  describe("given an evaluation whose verdict list already includes its inputs", () => {
    describe("when the card's details are expanded", () => {
      /** @scenario Inputs already present are shown without an extra request */
      it("shows the inputs without enabling the lazy fetch", () => {
        getEvaluationInputsUseQueryMock.mockImplementation(
          (_input: unknown, opts: { enabled?: boolean }) => ({
            data: undefined,
            isLoading: false,
            // surface enabled so we can assert it never flips on
            _enabled: opts?.enabled,
          }),
        );

        renderCard({
          ...baseEval,
          inputs: { input: "already here" },
        });

        fireEvent.click(screen.getByText("Show details"));

        expect(screen.getByText("already here")).toBeInTheDocument();
        // List already carried inputs, so the lazy query must stay disabled.
        for (const call of getEvaluationInputsUseQueryMock.mock.calls) {
          expect(call[1]).toEqual(expect.objectContaining({ enabled: false }));
        }
      });
    });
  });
});

describe("EvalCard header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEvaluationInputsUseQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
  });

  describe("given a categorising evaluator that returned only a category", () => {
    // How `langevals/llm_category` arrives: a label, and stand-ins where the
    // score and verdict would be.
    const categoryEval: EvalEntry = {
      name: "Max conversation outcome",
      score: 0,
      scoreType: "categorical",
      status: "pass",
      label: "resolved",
      evaluatorType: "langevals/llm_category",
      evaluationId: "eval-cat",
    };

    /** @scenario A category verdict leads the card header */
    it("leads with the category", () => {
      renderCard(categoryEval);
      expect(screen.getByText("resolved")).toBeInTheDocument();
    });

    /** @scenario A category verdict leads the card header */
    it("shows no PASS badge for a run that judged nothing", () => {
      renderCard(categoryEval);
      expect(screen.queryByText("PASS")).not.toBeInTheDocument();
    });

    /** @scenario A category verdict leads the card header */
    it("shows no score, the zero being a stand-in for a score never produced", () => {
      renderCard(categoryEval);
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    /** @scenario A category verdict leads the card header */
    it("does not repeat the category under Show details", () => {
      renderCard(categoryEval);
      // Inputs are still lazily loadable, so the toggle may exist; what must
      // not exist is a second copy of the category.
      const toggle = screen.queryByText("Show details");
      if (toggle) fireEvent.click(toggle);
      expect(screen.queryByText("Label")).not.toBeInTheDocument();
      expect(screen.getAllByText("resolved")).toHaveLength(1);
    });
  });

  describe("given an evaluator that returned a label alongside a real verdict", () => {
    const labelledEval: EvalEntry = {
      name: "Toxicity",
      score: 0.9,
      scoreType: "numeric",
      status: "pass",
      label: "safe",
      passed: true,
      evaluationId: "eval-labelled",
    };

    /** @scenario A label alongside a real verdict rides next to the badge */
    it("keeps the badge and the score, and adds the label beside them", () => {
      renderCard(labelledEval);
      expect(screen.getByText("PASS")).toBeInTheDocument();
      expect(screen.getByText("safe")).toBeInTheDocument();
      expect(screen.getByText("0.90")).toBeInTheDocument();
    });
  });

  describe("given an evaluator that returned no label", () => {
    /** @scenario An evaluator with no label is unchanged */
    it("shows the badge, the name and the score, and no category chip", () => {
      renderCard({
        name: "Topic Adherence",
        score: 8.2,
        scoreType: "numeric",
        status: "pass",
        evaluationId: "eval-plain",
      });

      expect(screen.getByText("PASS")).toBeInTheDocument();
      expect(screen.getByText("Topic Adherence")).toBeInTheDocument();
      expect(screen.getByText("8.2")).toBeInTheDocument();
      expect(screen.getByText("/ 10")).toBeInTheDocument();
    });
  });
});
