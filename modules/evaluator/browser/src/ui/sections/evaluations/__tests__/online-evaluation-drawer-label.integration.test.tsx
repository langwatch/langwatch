/**
 * @vitest-environment jsdom
 * @see modules/evaluator/specs/evaluator-versioning.feature
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../behavior/evaluator-api.ts", async () =>
  (await import("./online-evaluation-drawer.test-helpers.tsx")).createApiMock(),
);
vi.mock("@langwatch/evaluator-client", async () =>
  (await import("./online-evaluation-drawer.test-helpers.tsx")).createEvaluatorClientMock(),
);
vi.mock("@langwatch/browser-host/use-organization-team-project", async () =>
  (await import("./online-evaluation-drawer.test-helpers.tsx")).createOrgMock(),
);
vi.mock("@langwatch/browser-host/drawer", () => ({
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

import {
  clearOnlineEvaluationDrawerState,
  OnlineEvaluationDrawer,
} from "../online-evaluation-drawer.tsx";
import {
  mockUpdateMutate,
  resetState,
  state,
  Wrapper,
} from "./online-evaluation-drawer.test-helpers.tsx";

describe("<OnlineEvaluationDrawer /> deploy label", () => {
  beforeEach(() => {
    resetState();
    clearOnlineEvaluationDrawerState();
    mockUpdateMutate.mockClear();
    state.mockVersions = {
      versions: [{ version: 2 }, { version: 1 }],
      labels: [{ label: "production", version: 1 }],
      availableLabels: ["production", "staging"],
    };
  });

  afterEach(cleanup);

  /** @scenario "The online evaluation drawer picks the evaluator deploy label" */
  it("starts on latest and saves the picked label", async () => {
    const user = userEvent.setup();
    render(<OnlineEvaluationDrawer open monitorId="monitor-1" />, { wrapper: Wrapper });

    const trigger = await screen.findByTestId("online-evaluation-label-select");
    expect(trigger).toHaveTextContent("latest");
    expect(trigger).toHaveTextContent("v2");

    await user.click(screen.getByRole("combobox", { name: "Deploy label" }));
    await user.click(await screen.findByRole("option", { name: /production/ }));
    await waitFor(() => expect(trigger).toHaveTextContent("production"));

    await user.click(screen.getByTestId("online-evaluation-save"));
    await waitFor(() =>
      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "monitor-1", evaluatorLabel: "production" }),
      ),
    );
  });

  /** @scenario "The online evaluation drawer picks the evaluator deploy label" */
  it("shows the label a saved online evaluation is pinned to", async () => {
    state.mockMonitor = {
      ...state.mockMonitor,
      evaluatorLabel: "production",
    } as typeof state.mockMonitor;
    render(<OnlineEvaluationDrawer open monitorId="monitor-1" />, { wrapper: Wrapper });

    const trigger = await screen.findByTestId("online-evaluation-label-select");
    await waitFor(() => expect(trigger).toHaveTextContent("production"));
    expect(trigger).toHaveTextContent("v1");
  });
});
