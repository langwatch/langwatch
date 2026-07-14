/**
 * @vitest-environment jsdom
 *
 * Integration tests for EvaluationStatusItem — error rendering.
 *
 * Covers @integration scenarios from
 * specs/evaluators/evaluator-error-propagation.feature:
 * - "the trace evaluations tab shows the failure message on an errored row"
 * - "the trace evaluations tab shows details even when error message is empty"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElasticSearchEvaluation } from "~/server/tracer/types";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { project: "test-proj" } }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-test", slug: "test-proj" },
    organization: { id: "org-test" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    evaluators: {
      getById: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    monitors: {
      getById: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

import { EvaluationStatusItem } from "../EvaluationStatusItem";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildEvaluation(
  overrides: Partial<ElasticSearchEvaluation> = {},
): ElasticSearchEvaluation {
  return {
    evaluation_id: "eval_1",
    evaluator_id: "mon_1",
    name: "Azure Content Safety",
    type: "azure/content_safety",
    status: "processed",
    passed: true,
    score: 0.9,
    timestamps: { inserted_at: Date.now(), finished_at: Date.now() },
    ...overrides,
  } as ElasticSearchEvaluation;
}

describe("<EvaluationStatusItem /> error rendering", () => {
  afterEach(cleanup);

  describe("given an evaluation run with status=error and an error message", () => {
    it("shows the error message inline", () => {
      const check = buildEvaluation({
        status: "error",
        passed: undefined,
        score: undefined,
        error: {
          has_error: true,
          message:
            "Azure Content Safety request failed: Could not connect to https://bad.example.com/",
          stacktrace: [],
        },
      });

      render(<EvaluationStatusItem check={check} />, { wrapper: Wrapper });

      expect(
        screen.getByText(/Could not connect to https:\/\/bad\.example\.com/),
      ).toBeInTheDocument();
      expect(screen.getByText("Error")).toBeInTheDocument();
    });
  });

  describe("given a legacy error row with only a details string and no error object", () => {
    it("still surfaces the details as the failure explanation", () => {
      const check = buildEvaluation({
        status: "error",
        passed: undefined,
        score: undefined,
        details:
          "Legacy path: Azure returned 401 Unauthorized — invalid subscription key",
      });

      render(<EvaluationStatusItem check={check} />, { wrapper: Wrapper });

      expect(
        screen.getByText(/Azure returned 401 Unauthorized/),
      ).toBeInTheDocument();
    });
  });

  describe("given a processed evaluation", () => {
    it("does not render any red error block", () => {
      const check = buildEvaluation({
        status: "processed",
        passed: true,
        details: "All checks passed",
      });

      render(<EvaluationStatusItem check={check} />, { wrapper: Wrapper });

      expect(screen.queryByText("Error")).not.toBeInTheDocument();
    });
  });
});
