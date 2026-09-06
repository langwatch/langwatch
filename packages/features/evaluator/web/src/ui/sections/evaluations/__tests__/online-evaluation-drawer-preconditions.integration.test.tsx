/**
 * @vitest-environment jsdom
 * @see specs/monitors/online-evaluation-preconditions.feature
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", async () =>
  (await import("./online-evaluation-drawer.test-helpers")).createApiMock(),
);
vi.mock("@langwatch/ui-host/use-organization-team-project", async () =>
  (await import("./online-evaluation-drawer.test-helpers")).createOrgMock(),
);
vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getDrawerStack: () => [],
  navigateToDrawer: vi.fn(),
  setFlowCallbacks: vi.fn(),
  getFlowCallbacks: () => void 0,
}));

import { DEFAULT_PRECONDITION } from "../../../../model/preconditions/precondition-field-utils";
import {
  clearOnlineEvaluationDrawerState,
  OnlineEvaluationDrawer,
} from "../online-evaluation-drawer";
import { resetState, state, Wrapper } from "./online-evaluation-drawer.test-helpers";

describe("<OnlineEvaluationDrawer /> preconditions", () => {
  beforeEach(() => {
    resetState();
    clearOnlineEvaluationDrawerState();
    state.mockMonitor = {
      ...state.mockMonitor,
      preconditions: [{ ...DEFAULT_PRECONDITION }],
    } as typeof state.mockMonitor;
  });

  afterEach(cleanup);

  describe("given an evaluation carrying only the default precondition", () => {
    describe("when the preconditions section renders", () => {
      /** @scenario "Default-only precondition shows collapsed summary" */
      it("shows the collapsed summary and the way to add a precondition", async () => {
        render(<OnlineEvaluationDrawer open monitorId="monitor-1" />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(
            screen.getByText("This evaluation will run on every application trace"),
          ).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "Add Precondition" })).toBeInTheDocument();
      });

      /** @scenario "Default-only precondition shows collapsed summary" */
      it("draws no precondition row while the summary stands", async () => {
        render(<OnlineEvaluationDrawer open monitorId="monitor-1" />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(
            screen.getByText("This evaluation will run on every application trace"),
          ).toBeInTheDocument();
        });
        expect(screen.queryByText("When")).not.toBeInTheDocument();
      });
    });
  });
});
