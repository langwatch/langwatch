/**
 * @vitest-environment jsdom
 *
 * Regression test for the legacy evaluation wizard redirect page.
 *
 * Two things are under test. First the fire-once guard: the compat router is a
 * fresh object on every render, so a redirect effect that depends on it and has
 * no guard re-fires `replace` every render (in the browser that surfaced as
 * "Maximum update depth exceeded"). Each case re-renders repeatedly and asserts
 * `replace` is still called exactly once. Second the routing target: the wizard
 * was removed, so a bare URL opens a fresh workbench, a workbench-native
 * experiment opens in the workbench, and an experiment that predates the
 * workbench routes to the workflow it was run from instead.
 * See specs/experiments-v3/evaluation-creation-entrypoints.feature.
 */
import { ExperimentType } from "@prisma/client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, routerState, experimentState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  routerState: { query: {} as Record<string, unknown> },
  experimentState: {
    data: undefined as
      | { type?: string; workbenchState?: unknown; workflowId?: string }
      | undefined,
    isFetched: false,
  },
}));

// A new object each call, mirroring the real compat shim, so the redirect
// effect sees an unstable `router` dependency every render.
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: routerState.query, replace: replaceMock }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "test-project" },
  }),
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}));

// The page reads the experiment to decide where a slugged URL can open, so the
// tRPC hook is mocked and the branch under test is driven by `experimentState`.
vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      getExperimentBySlugOrId: {
        useQuery: () => ({
          data: experimentState.data,
          isFetched: experimentState.isFetched,
        }),
      },
    },
  },
}));

const { default: EvaluationWizardRedirect } = await import(
  "~/pages/[project]/evaluations/wizard"
);

const renderRepeatedly = () => {
  const { rerender } = render(<EvaluationWizardRedirect />);
  // Each re-render hands the effect a fresh router object; the guard must keep
  // the redirect from firing again.
  for (let i = 0; i < 4; i++) rerender(<EvaluationWizardRedirect />);
};

describe("Evaluation wizard redirect", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    routerState.query = {};
    experimentState.data = undefined;
    experimentState.isFetched = false;
  });

  describe("when there is no slug", () => {
    /** @scenario A bare legacy wizard URL redirects to a fresh workbench */
    it("redirects to a fresh workbench exactly once", () => {
      routerState.query = {};

      renderRepeatedly();

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith(
        "/test-project/experiments/workbench",
      );
    });
  });

  describe("when the experiment is workbench-native", () => {
    /** @scenario Legacy wizard URLs for workbench-native experiments redirect to the workbench */
    it("redirects to the slugged workbench exactly once", () => {
      routerState.query = { slug: "saved-1" };
      experimentState.data = { type: ExperimentType.EVALUATIONS_V3 };
      experimentState.isFetched = true;

      renderRepeatedly();

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith(
        "/test-project/experiments/workbench/saved-1",
      );
    });
  });

  describe("when the experiment predates the workbench", () => {
    /** @scenario Legacy wizard URLs for experiments that predate the workbench redirect to their workflow */
    it("redirects to the experiment's workflow exactly once", () => {
      routerState.query = { slug: "saved-2" };
      experimentState.data = {
        type: ExperimentType.BATCH_EVALUATION_V2,
        workflowId: "wf-9",
      };
      experimentState.isFetched = true;

      renderRepeatedly();

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/test-project/studio/wf-9");
    });
  });

  describe("when a slugged experiment is still loading", () => {
    it("waits for the experiment before redirecting", () => {
      routerState.query = { slug: "saved-3" };
      experimentState.isFetched = false;

      renderRepeatedly();

      expect(replaceMock).not.toHaveBeenCalled();
    });
  });
});
