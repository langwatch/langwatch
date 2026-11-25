/**
 * @vitest-environment jsdom
 * Spec: specs/monitors/online-evaluation-drawer-flow.feature
 * Spec: specs/monitors/pending-mappings-validation.feature
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../behavior/evaluator-api.ts", async () =>
  (
    await import("../ui/sections/evaluations/__tests__/online-evaluation-drawer.test-helpers.tsx")
  ).createApiMock(),
);
vi.mock("@langwatch/evaluator-client", async () =>
  (
    await import("../ui/sections/evaluations/__tests__/online-evaluation-drawer.test-helpers.tsx")
  ).createEvaluatorClientMock(),
);
vi.mock("@langwatch/browser-host/use-organization-team-project", async () =>
  (
    await import("../ui/sections/evaluations/__tests__/online-evaluation-drawer.test-helpers.tsx")
  ).createOrgMock(),
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
  mockCreateMutate,
  mockEvaluators,
  mockUpdateMutate,
  state,
  resetState,
  Wrapper,
} from "../ui/sections/evaluations/__tests__/online-evaluation-drawer.test-helpers.tsx";
import {
  clearOnlineEvaluationDrawerState,
  OnlineEvaluationDrawer,
} from "../ui/sections/evaluations/online-evaluation-drawer.tsx";

const originalFields = mockEvaluators[0]!.fields;

describe("<OnlineEvaluationDrawer /> creating with nothing chosen", () => {
  beforeEach(() => {
    resetState();
    clearOnlineEvaluationDrawerState();
    mockCreateMutate.mockClear();
  });

  afterEach(() => {
    cleanup();
    mockEvaluators[0]!.fields = originalFields;
  });

  /** @scenario "Pressing Create before choosing a level names the level" */
  it("keeps Create available, names the missing level on press and sends nothing", () => {
    render(<OnlineEvaluationDrawer open />, { wrapper: Wrapper });

    const create = screen.getByTestId("online-evaluation-save");
    expect(create).toBeEnabled();
    expect(screen.queryByText("Choose an evaluation level.")).not.toBeInTheDocument();

    fireEvent.click(create);

    expect(screen.getByText("Choose an evaluation level.")).toBeVisible();
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  /** @see specs/monitors/pending-mappings-validation.feature */
  /** @scenario "Saving with pending mappings names them and sends nothing" */
  it("names the pending mappings on press, focuses Configure and sends nothing", async () => {
    mockUpdateMutate.mockClear();
    mockEvaluators[0]!.fields = [
      { identifier: "input", type: "str" },
      { identifier: "mystery", type: "str" },
    ];
    state.mockMonitor = {
      ...state.mockMonitor,
      mappings: { mapping: {} },
    } as typeof state.mockMonitor;
    render(<OnlineEvaluationDrawer open monitorId="monitor-1" />, { wrapper: Wrapper });

    const save = await screen.findByTestId("online-evaluation-save");
    await waitFor(() => expect(screen.getByRole("button", { name: "Configure" })).toBeVisible());
    expect(save).toBeEnabled();

    fireEvent.click(save);

    expect(await screen.findByText("Complete all mappings first.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Configure" })).toHaveFocus();
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });
});
