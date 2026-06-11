/**
 * @vitest-environment jsdom
 *
 * Regression test for the legacy evaluation wizard redirect page.
 *
 * The compat router is a fresh object on every render, so a redirect effect
 * that depends on it and has no fire-once guard re-fires `replace` on every
 * render. In the browser that surfaced as "Maximum update depth exceeded".
 * This test re-renders the page repeatedly (each render hands the effect a new
 * router object) and asserts `replace` is still called exactly once.
 * See specs/experiments-v3/evaluation-creation-entrypoints.feature.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, routerState } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  routerState: { query: {} as Record<string, unknown> },
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

const { default: EvaluationWizardRedirect } = await import(
  "~/pages/[project]/evaluations/wizard"
);

describe("Evaluation wizard redirect", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  describe("when the page re-renders repeatedly", () => {
    /** @scenario Legacy wizard URLs redirect to the workbench */
    it("redirects to the slugged workbench exactly once", () => {
      routerState.query = { slug: "saved-1" };
      const { rerender } = render(<EvaluationWizardRedirect />);

      // Each re-render hands the effect a fresh router object; the guard must
      // keep the redirect from firing again.
      for (let i = 0; i < 4; i++) rerender(<EvaluationWizardRedirect />);

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith(
        "/test-project/experiments/workbench/saved-1",
      );
    });
  });

  describe("when there is no slug", () => {
    /** @scenario Legacy wizard URLs redirect to the workbench */
    it("redirects to a fresh workbench", () => {
      routerState.query = {};
      render(<EvaluationWizardRedirect />);

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith(
        "/test-project/experiments/workbench",
      );
    });
  });
});
