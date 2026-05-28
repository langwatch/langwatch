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

import type { EvalEntry } from "../utils";
import { EvalCard } from "../EvalCard";

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
