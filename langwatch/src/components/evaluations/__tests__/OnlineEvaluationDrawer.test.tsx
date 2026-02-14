/**
 * @vitest-environment jsdom
 *
 * Integration tests for OnlineEvaluationDrawer.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 *
 * This file covers:
 * - OnlineEvaluationDrawer + EvaluatorListDrawer Integration (critical navigation test)
 * - Progressive disclosure (new evaluation mode)
 * - Basic rendering (new evaluation mode)
 * - Evaluator selection
 * - Name field behavior
 * - Sampling input
 * - Validation
 *
 * See OnlineEvaluationDrawerEditSave.test.tsx for:
 * - Save functionality, edit mode, close behavior, reset, state persistence,
 *   level selector, mappings, pending mappings warning, level change
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CurrentDrawer } from "~/components/CurrentDrawer";
import {
  clearDrawerStack,
  clearFlowCallbacks,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import {
  clearOnlineEvaluationDrawerState,
  OnlineEvaluationDrawer,
} from "../OnlineEvaluationDrawer";
import {
  state,
  mockPush,
  mockEvaluators,
  Wrapper,
  resetState,
} from "./OnlineEvaluationDrawer.test-helpers.tsx";

// vi.mock() factories are hoisted above imports, so we use async + dynamic import
vi.mock("next/router", async () =>
  (await import("./OnlineEvaluationDrawer.test-helpers.tsx")).createRouterMock(),
);
vi.mock("~/utils/api", async () =>
  (await import("./OnlineEvaluationDrawer.test-helpers.tsx")).createApiMock(),
);
vi.mock("~/hooks/useOrganizationTeamProject", async () =>
  (await import("./OnlineEvaluationDrawer.test-helpers.tsx")).createOrgMock(),
);
vi.mock("~/stores/upgradeModalStore", async () =>
  (await import("./OnlineEvaluationDrawer.test-helpers.tsx")).createUpgradeModalMock(),
);
vi.mock("~/hooks/useLicenseEnforcement", async () =>
  (await import("./OnlineEvaluationDrawer.test-helpers.tsx")).createLicenseEnforcementMock(),
);

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = vi.fn();

/**
 * CRITICAL Integration test - Tests the REAL navigation flow where the drawer's
 * open prop actually changes during navigation (as happens in production).
 */
describe("OnlineEvaluationDrawer + EvaluatorListDrawer Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    clearDrawerStack();
    clearFlowCallbacks();
    clearOnlineEvaluationDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * Helper to select evaluation level in this test suite
   */
  const selectLevelInCriticalTest = async (
    user: ReturnType<typeof userEvent.setup>,
    level: "trace" | "thread" = "trace",
  ) => {
    const levelLabel = level === "trace" ? /Trace Level/i : /Thread Level/i;
    await waitFor(() => {
      expect(screen.getByLabelText(levelLabel)).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(levelLabel));
    await vi.advanceTimersByTimeAsync(50);
  };

  it("CRITICAL: evaluator selection persists when returning from EvaluatorListDrawer", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Use CurrentDrawer for proper drawer navigation
    state.mockQuery = { "drawer.open": "onlineEvaluation" };

    const { rerender } = render(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 1: Select level first (progressive disclosure)
    await selectLevelInCriticalTest(user, "trace");

    // Step 2: OnlineEvaluationDrawer now shows Select Evaluator
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });

    // Step 3: Click "Select Evaluator" - this navigates to evaluator list
    await user.click(screen.getByText("Select Evaluator"));

    // Step 4: URL should now have drawer.open=evaluatorList
    await waitFor(() => {
      expect(state.mockQuery["drawer.open"]).toBe("evaluatorList");
    });

    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 5: EvaluatorListDrawer should now be visible with evaluators
    await waitFor(() => {
      expect(screen.getByText("PII Check")).toBeInTheDocument();
    });

    // Step 6: Click on "PII Check" evaluator to select it
    const piiCheckCard = screen.getByTestId("evaluator-card-evaluator-1");
    await user.click(piiCheckCard);

    await vi.advanceTimersByTimeAsync(200);

    // Step 7: NEW FLOW - After selection, it goes to EvaluatorEditorDrawer (not back to OnlineEvaluation)
    await waitFor(() => {
      expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
    });

    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 8: EvaluatorEditorDrawer should be visible
    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    // Step 9: Click Cancel to go back to OnlineEvaluationDrawer
    await user.click(screen.getByText("Cancel"));

    await vi.advanceTimersByTimeAsync(100);

    // Step 10: Should be back at OnlineEvaluationDrawer
    await waitFor(() => {
      expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
    });

    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 11: CRITICAL - OnlineEvaluationDrawer should show the selected evaluator
    await waitFor(() => {
      // Should show "PII Check" in the selection box (not "Select Evaluator")
      expect(screen.getByText("PII Check")).toBeInTheDocument();
      // Name should be auto-filled
      const nameInput = screen.getByPlaceholderText(
        "Enter evaluation name",
      ) as HTMLInputElement;
      expect(nameInput.value).toBe("PII Check");
    });
  });
});

describe("OnlineEvaluationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    clearDrawerStack();
    clearFlowCallbacks();
    clearOnlineEvaluationDrawerState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * Helper to select evaluation level (required before evaluator selection is shown)
   */
  const selectLevel = async (
    user: ReturnType<typeof userEvent.setup>,
    level: "trace" | "thread" = "trace",
  ) => {
    const levelLabel = level === "trace" ? /Trace Level/i : /Thread Level/i;
    await waitFor(() => {
      expect(screen.getByLabelText(levelLabel)).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(levelLabel));
    await vi.advanceTimersByTimeAsync(50);
  };

  describe("Progressive disclosure - New evaluation mode", () => {
    it("initially shows only Evaluation Level section", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Evaluation Level")).toBeInTheDocument();
        expect(screen.getByLabelText(/Trace Level/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Thread Level/i)).toBeInTheDocument();
      });

      // Evaluator section should NOT be visible yet
      expect(screen.queryByText("Evaluator")).not.toBeInTheDocument();
      expect(screen.queryByText("Select Evaluator")).not.toBeInTheDocument();
      // Name, Sampling, Preconditions should NOT be visible
      expect(screen.queryByText("Name")).not.toBeInTheDocument();
      expect(screen.queryByText(/Sampling/)).not.toBeInTheDocument();
    });

    it("shows Evaluator section after selecting level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Evaluator")).toBeInTheDocument();
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Name, Sampling should still NOT be visible (need evaluator first)
      expect(screen.queryByText("Name")).not.toBeInTheDocument();
      expect(screen.queryByText(/Sampling/)).not.toBeInTheDocument();
    });

    it("shows all fields after selecting evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Simulate selecting an evaluator via flow callback
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // Go back to online drawer (via goBack from editor)
      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      await waitFor(() => {
        // Now all fields should be visible
        expect(screen.getByText("Name")).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText("Enter evaluation name"),
        ).toBeInTheDocument();
        expect(screen.getByText(/Sampling/)).toBeInTheDocument();
        expect(screen.getByText(/Preconditions/)).toBeInTheDocument();
      });
    });
  });

  describe("Basic rendering - New evaluation mode", () => {
    it("shows New Online Evaluation header", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows Evaluator field label after selecting level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Evaluator")).toBeInTheDocument();
      });
    });

    it("shows Select Evaluator button after selecting level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });

    it("shows Cancel and Create buttons", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
        expect(
          screen.getByText("Create Online Evaluation"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Evaluator selection", () => {
    it("opens evaluator list when clicking Select Evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled();
        const lastCall =
          mockPush.mock.calls[mockPush.mock.calls.length - 1]?.[0];
        expect(lastCall).toContain("drawer.open=evaluatorList");
      });
    });

    it("sets flow callback for evaluator selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        const callbacks = getFlowCallbacks("evaluatorList");
        expect(callbacks).toBeDefined();
        expect(callbacks?.onSelect).toBeDefined();
      });
    });

    it("displays selected evaluator after selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      // Simulate evaluator selection via callback
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });

    it("pre-fills name with evaluator name when name is empty", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        const nameInput = screen.getByPlaceholderText(
          "Enter evaluation name",
        ) as HTMLInputElement;
        expect(nameInput.value).toBe("PII Check");
      });
    });

    it("shows selected evaluator in clickable selection box", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");
      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
        // Selection box should be clickable (has caret indicator for re-selection)
        const selectionBox = screen.getByText("PII Check").closest("button");
        expect(selectionBox).toBeInTheDocument();
      });
    });

    it("shows Remove Selection link when evaluator is selected", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");

      // Initially no Remove Selection link
      expect(screen.queryByText("(Remove Selection)")).not.toBeInTheDocument();

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // Go back to online drawer
      state.mockQuery = { "drawer.open": "onlineEvaluation" };
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );
      await vi.advanceTimersByTimeAsync(100);

      // Now Remove Selection link should be visible
      await waitFor(() => {
        expect(screen.getByText("(Remove Selection)")).toBeInTheDocument();
      });
    });

    it("clears evaluator selection when clicking Remove Selection", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // Go back to online drawer
      state.mockQuery = { "drawer.open": "onlineEvaluation" };
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );
      await vi.advanceTimersByTimeAsync(100);

      // Verify evaluator is selected
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Click Remove Selection
      await user.click(screen.getByText("(Remove Selection)"));
      await vi.advanceTimersByTimeAsync(100);

      // Evaluator should be cleared - back to "Select Evaluator" button
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
        expect(screen.queryByText("PII Check")).not.toBeInTheDocument();
        // Remove Selection link should be gone
        expect(
          screen.queryByText("(Remove Selection)"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("Name field behavior", () => {
    it("allows typing in name field after selecting evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // After selecting evaluator, the editor opens. Go back to online drawer.
      state.mockQuery = { "drawer.open": "onlineEvaluation" };
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );
      await vi.advanceTimersByTimeAsync(100);

      const nameInput = screen.getByPlaceholderText("Enter evaluation name");
      await user.clear(nameInput);
      await user.type(nameInput, "My Custom Monitor");

      expect(nameInput).toHaveValue("My Custom Monitor");
    });

    it("does not override custom name when changing evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select first evaluator (name gets pre-filled)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // After selecting evaluator, the editor opens. Go back to online drawer.
      state.mockQuery = { "drawer.open": "onlineEvaluation" };
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );
      await vi.advanceTimersByTimeAsync(100);

      // Change to custom name
      const nameInput = screen.getByPlaceholderText("Enter evaluation name");
      await user.clear(nameInput);
      await user.type(nameInput, "My Custom Name");

      // Select another evaluator via edit flow
      await user.click(screen.getByText("PII Check"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);
      await vi.advanceTimersByTimeAsync(200);

      // Name should still be custom (not overwritten)
      expect(nameInput).toHaveValue("My Custom Name");
    });
  });

  describe("Sampling input", () => {
    it("shows 1.0 (100%) sampling by default after selecting evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        const samplingInput = screen.getByDisplayValue("1") as HTMLInputElement;
        expect(samplingInput).toBeInTheDocument();
      });
    });

    it("shows helper text explaining sampling in edit mode", async () => {
      // Use edit mode where the evaluator is already loaded
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Check for the helper text
      await waitFor(() => {
        // Text appears in both preconditions and sampling sections
        const texts = screen.getAllByText(/This evaluation will run on/);
        expect(texts.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Validation", () => {
    it("Create button is disabled when no level selected", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const createButton = screen.getByText("Create Online Evaluation");
        expect(createButton).toBeDisabled();
      });
    });

    it("Create button is disabled when no evaluator selected", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        const createButton = screen.getByText("Create Online Evaluation");
        expect(createButton).toBeDisabled();
      });
    });

    it("Create button is disabled when name is empty", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      // After selecting evaluator, the editor opens. Go back to online drawer.
      state.mockQuery = { "drawer.open": "onlineEvaluation" };
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );
      await vi.advanceTimersByTimeAsync(100);

      // Wait for the name to be auto-filled
      const nameInput = screen.getByPlaceholderText(
        "Enter evaluation name",
      ) as HTMLInputElement;
      await waitFor(() => {
        expect(nameInput.value).toBe("PII Check");
      });

      // Clear the auto-filled name
      await user.clear(nameInput);

      // Wait for the name to actually be empty
      await waitFor(() => {
        expect(nameInput.value).toBe("");
      });

      // Now check the button is disabled
      await waitFor(() => {
        const createButton = screen.getByText("Create Online Evaluation");
        expect(createButton).toBeDisabled();
      });
    });

    it("Create button is enabled when level, evaluator and name are set", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await user.click(screen.getByText("Select Evaluator"));

      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        const createButton = screen.getByText("Create Online Evaluation");
        expect(createButton).not.toBeDisabled();
      });
    });
  });
});
