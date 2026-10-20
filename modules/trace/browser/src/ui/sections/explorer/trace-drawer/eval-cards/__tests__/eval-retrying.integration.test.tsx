/**
 * Integration coverage for runs the evaluator service could not take yet.
 * @vitest-environment jsdom
 * @see specs/traces-v2/evaluations.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../../../behavior/trace-api.ts", () => ({
  api: {
    evaluations: {
      getEvaluationInputs: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));

vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_test" },
    organization: {},
    team: undefined,
    isFetching: false,
  }),
}));

vi.mock("../../../../../../behavior/explorer/use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({ projectId: "project_test", tenantId: null }),
}));

import { EvalCard } from "../eval-card.tsx";
import { RetryingEvalRow } from "../retrying-eval-row.tsx";

afterEach(() => {
  cleanup();
});

describe("given a pending evaluation that failed 2 attempts", () => {
  describe("when the Evals accordion is expanded", () => {
    /** @scenario A pending run with failed attempts shows as a retrying row */
    it("shows a retrying row with the attempt, the last error and the next try", () => {
      renderWithDesignSystem(
        <RetryingEvalRow
          run={{
            evaluationId: "eval-1",
            name: "Toxicity",
            attempts: 2,
            lastAttemptError: "evaluator unavailable",
            lastAttemptAt: Date.now() - 60_000,
            nextAttemptAt: Date.now() + 3.5 * 60_000,
          }}
        />,
      );

      expect(
        screen.getByText(
          /Retrying · attempt 2 · last error: evaluator unavailable · next try in 4m/,
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("given an evaluation that ended in error after 3 attempts", () => {
  describe("when the Evals accordion is expanded", () => {
    /** @scenario A failed run that was attempted more than once says how many attempts it took */
    it("says how many attempts it took beside the error", () => {
      renderWithDesignSystem(
        <EvalCard
          eval_={{
            name: "Toxicity",
            score: null,
            scoreType: "numeric",
            status: "error",
            evaluationId: "eval-2",
            errorMessage: "evaluator unavailable",
            attempts: 3,
          }}
        />,
      );

      expect(screen.getByText(/evaluator unavailable · after 3 attempts/)).toBeInTheDocument();
    });
  });
});
