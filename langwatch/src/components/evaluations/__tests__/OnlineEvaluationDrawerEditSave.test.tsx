/**
 * @vitest-environment jsdom
 *
 * Integration tests for OnlineEvaluationDrawer - Edit, Save, and Navigation.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 *
 * This file covers:
 * - Save functionality (create mode)
 * - Edit mode
 * - Close behavior
 * - Reset on reopen
 * - State persistence during navigation
 * - Integration with EvaluatorListDrawer
 * - Evaluation Level selector
 * - Mappings functionality
 * - Pending mappings warning
 * - Level change with evaluator selected
 *
 * See OnlineEvaluationDrawer.test.tsx for:
 * - Critical navigation integration test, progressive disclosure,
 *   basic rendering, evaluator selection, name field, sampling, validation
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
  mockCreateMutate,
  mockUpdateMutate,
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

  describe("Save functionality - Create mode", () => {
    it("calls create mutation with correct data", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          name: "PII Check",
          checkType: "presidio/pii_detection",
          evaluatorId: "evaluator-1",
          sample: 1.0,
        }),
      );
    });

    it("calls onSave callback after successful create", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnSave = vi.fn();
      render(<OnlineEvaluationDrawer open={true} onSave={mockOnSave} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() =>
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled(),
      );

      await user.click(screen.getByText("Create Online Evaluation"));

      expect(mockOnSave).toHaveBeenCalled();
    });

    it("clears state after successful save so new drawer starts fresh", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { unmount } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      // Set up a complete evaluation
      await selectLevel(user, "trace");
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() =>
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled(),
      );

      // Save the evaluation
      await user.click(screen.getByText("Create Online Evaluation"));
      await vi.advanceTimersByTimeAsync(100);

      // Unmount and remount to simulate opening a new drawer
      unmount();
      await vi.advanceTimersByTimeAsync(100);

      // Render a new drawer (simulating clicking "New" button)
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });
      await vi.advanceTimersByTimeAsync(200);

      // The drawer should start fresh - no level selected (progressive disclosure)
      // The Evaluator section should be hidden (no "Select Evaluator" button visible)
      // because level is not selected yet
      await waitFor(() => {
        // The evaluator section is hidden until level is selected
        expect(screen.queryByText("Select Evaluator")).not.toBeInTheDocument();
        // The name field is also hidden
        expect(
          screen.queryByPlaceholderText("Enter evaluation name"),
        ).not.toBeInTheDocument();
      });
    });

    it("saves workflow evaluator with checkType 'workflow' instead of 'langevals/basic'", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select the workflow evaluator (evaluator-5)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      // mockEvaluators[4] is the workflow evaluator
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[4]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      // Verify checkType is "workflow", NOT "langevals/basic"
      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          name: "Custom Workflow Scorer",
          checkType: "workflow",
          evaluatorId: "evaluator-5",
        }),
      );

      // Also verify it was NOT called with "langevals/basic"
      expect(mockCreateMutate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: "langevals/basic",
        }),
      );
    });

    it("CRITICAL: workflow evaluator Select Evaluator button works in EvaluatorEditorDrawer", async () => {
      // This test verifies the full flow:
      // 1. User opens OnlineEvaluationDrawer
      // 2. Selects level
      // 3. Clicks Select Evaluator
      // 4. Selects a workflow evaluator from the list
      // 5. EvaluatorEditorDrawer opens with "Select Evaluator" button
      // 6. User clicks "Select Evaluator" button
      // 7. Drawer should close and evaluator should be selected
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockCreateMutate.mockClear();

      // Use CurrentDrawer to test the full flow through multiple drawers
      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Step 1: Select level first
      const levelLabel = /Trace Level/i;
      await waitFor(() => {
        expect(screen.getByLabelText(levelLabel)).toBeInTheDocument();
      });
      await user.click(screen.getByLabelText(levelLabel));
      await vi.advanceTimersByTimeAsync(50);

      // Step 2: Click "Select Evaluator"
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Step 3: EvaluatorListDrawer opens
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorList");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Step 4: Wait for evaluator list and click on workflow evaluator
      await waitFor(() => {
        expect(screen.getByText("Custom Workflow Scorer")).toBeInTheDocument();
      });

      // Click on the workflow evaluator card
      const workflowEvaluatorCard = screen.getByTestId("evaluator-card-evaluator-5");
      await user.click(workflowEvaluatorCard);

      await vi.advanceTimersByTimeAsync(200);

      // Step 5: EvaluatorEditorDrawer should open
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Step 6: EvaluatorEditorDrawer should show "Select Evaluator" button
      await waitFor(() => {
        expect(screen.getByTestId("save-evaluator-button")).toBeInTheDocument();
        expect(screen.getByTestId("save-evaluator-button")).toHaveTextContent("Select Evaluator");
      });

      // Step 7: Click the "Select Evaluator" button
      await user.click(screen.getByTestId("save-evaluator-button"));
      await vi.advanceTimersByTimeAsync(200);

      // Step 8: Should navigate back to OnlineEvaluationDrawer
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Step 9: The workflow evaluator should be selected
      await waitFor(() => {
        expect(screen.getByText("Custom Workflow Scorer")).toBeInTheDocument();
      });
    });

    it("built-in evaluator still saves with correct checkType from config", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockCreateMutate.mockClear();
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select the PII Check evaluator (evaluator-1, checkType: presidio/pii_detection)
      // This evaluator has auto-mappable fields
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      // Verify checkType comes from config.evaluatorType
      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: "presidio/pii_detection",
          evaluatorId: "evaluator-1",
        }),
      );
    });
  });

  describe("Edit mode", () => {
    it("shows Edit Online Evaluation header in edit mode", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText("Edit Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows Save Changes button instead of Create", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument();
        expect(screen.queryByText("Create")).not.toBeInTheDocument();
      });
    });

    it("loads existing monitor data", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        const nameInput = screen.getByPlaceholderText(
          "Enter evaluation name",
        ) as HTMLInputElement;
        expect(nameInput.value).toBe("My PII Monitor");
      });

      await waitFor(() => {
        // Sample rate from mock is 0.5
        const samplingInput = screen.getByDisplayValue(
          "0.5",
        ) as HTMLInputElement;
        expect(samplingInput).toBeInTheDocument();
      });
    });

    it("loads linked evaluator", async () => {
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });

    it("calls update mutation in edit mode", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Save Changes"));

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "monitor-1",
          projectId: "test-project-id",
        }),
      );
    });

    it("loads thread level correctly in edit mode", async () => {
      // Temporarily change mockMonitor to thread level
      const originalLevel = state.mockMonitor.level;
      state.mockMonitor.level = "thread";

      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Thread level should be selected (check via data-state attribute)
      await waitFor(() => {
        // Find the Thread Level label and check it's in checked state
        const threadLevelLabel = screen
          .getByText("Thread Level")
          .closest("label");
        expect(threadLevelLabel).toHaveAttribute("data-state", "checked");
      });

      // Restore original level
      state.mockMonitor.level = originalLevel;
    });
  });

  describe("Close behavior", () => {
    it("calls onClose when clicking Cancel", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();
      render(<OnlineEvaluationDrawer open={true} onClose={mockOnClose} />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("does not render when open is false", () => {
      render(<OnlineEvaluationDrawer open={false} />, { wrapper: Wrapper });

      expect(
        screen.queryByText("New Online Evaluation"),
      ).not.toBeInTheDocument();
    });

    it("shows confirmation dialog when closing with unsaved changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();

      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      render(<OnlineEvaluationDrawer open={true} onClose={mockOnClose} />, {
        wrapper: Wrapper,
      });

      // Make changes to trigger unsaved state
      await selectLevel(user, "trace");

      // Try to close - should show confirmation
      await user.click(screen.getByText("Cancel"));

      expect(confirmSpy).toHaveBeenCalledWith(
        "You have unsaved changes. Are you sure you want to close?",
      );
      // Since we returned false, onClose should NOT have been called
      expect(mockOnClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it("closes without confirmation when there are no unsaved changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();

      // Clear any persisted state from previous tests
      clearOnlineEvaluationDrawerState();

      // Mock window.confirm to verify it's NOT called
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      render(<OnlineEvaluationDrawer open={true} onClose={mockOnClose} />, {
        wrapper: Wrapper,
      });

      // Wait for effects to run and initial values to be set
      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Don't make any changes - just close immediately
      await user.click(screen.getByText("Cancel"));

      // Confirm should NOT have been called since there are no changes
      expect(confirmSpy).not.toHaveBeenCalled();
      // onClose SHOULD have been called
      expect(mockOnClose).toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it("closes when user confirms unsaved changes dialog", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockOnClose = vi.fn();

      // Mock window.confirm to return true (user confirms)
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

      render(<OnlineEvaluationDrawer open={true} onClose={mockOnClose} />, {
        wrapper: Wrapper,
      });

      // Make changes to trigger unsaved state
      await selectLevel(user, "trace");

      // Try to close - user confirms
      await user.click(screen.getByText("Cancel"));

      expect(confirmSpy).toHaveBeenCalled();
      // Since we returned true, onClose SHOULD have been called
      expect(mockOnClose).toHaveBeenCalled();

      confirmSpy.mockRestore();
    });
  });

  describe("Reset on reopen", () => {
    it("resets form when drawer reopens in create mode after true close", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
        wrapper: Wrapper,
      });

      await selectLevel(user, "trace");

      // Select evaluator and enter name
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Close drawer
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={false} />
        </Wrapper>,
      );

      // Clear callbacks and drawer state (simulates a true close via Cancel/X button
      // which calls handleClose() to clear the persisted state)
      clearFlowCallbacks();
      clearOnlineEvaluationDrawerState();

      // Reopen drawer
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
        </Wrapper>,
      );

      // Should be reset - level is null, so evaluator section is hidden
      await waitFor(() => {
        // Evaluator section should not be visible (no level selected)
        expect(screen.queryByText("Select Evaluator")).not.toBeInTheDocument();
        // Level should show as unselected
        expect(screen.getByText("Evaluation Level")).toBeInTheDocument();
      });
    });
  });

  describe("State persistence during navigation", () => {
    it("preserves selected evaluator when navigating to evaluator list and back", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // First, select an evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Change the name to something custom
      const nameInput = screen.getByPlaceholderText(
        "Enter evaluation name",
      ) as HTMLInputElement;
      await user.clear(nameInput);
      await user.type(nameInput, "My Custom Monitor Name");

      await waitFor(() => {
        expect(nameInput.value).toBe("My Custom Monitor Name");
      });

      // Now click on the selection box to navigate to evaluator list again (caret indicates clickable)
      const selectionBox = screen.getByText("PII Check").closest("button");
      await user.click(selectionBox!);

      // Clear the flow callbacks to simulate navigation
      clearFlowCallbacks();

      // The evaluator should still be selected (we didn't close the drawer, just navigated)
      // When user comes back without selecting a new evaluator, state should be preserved
      await waitFor(() => {
        // The evaluator is still shown because we're still in the same session
        expect(screen.getByText("PII Check")).toBeInTheDocument();
        expect(nameInput.value).toBe("My Custom Monitor Name");
      });
    });

    it("updates evaluator when selecting a different one after navigation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select first evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Clear name to ensure it gets updated
      const nameInput = screen.getByPlaceholderText(
        "Enter evaluation name",
      ) as HTMLInputElement;
      await user.clear(nameInput);

      // Click selection box to select a different evaluator (caret indicates clickable)
      const selectionBox = screen.getByText("PII Check").closest("button");
      await user.click(selectionBox!);
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select the second evaluator
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      // Should now show the new evaluator and update the name
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        expect(nameInput.value).toBe("Exact Match");
      });
    });
  });

  describe("Integration with EvaluatorListDrawer", () => {
    it("flow callback updates OnlineEvaluationDrawer state when evaluator selected", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await selectLevel(user, "trace");

      // Click to open evaluator list
      await user.click(screen.getByText("Select Evaluator"));

      // Get the flow callback
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      const flowCallbacks = getFlowCallbacks("evaluatorList");
      expect(flowCallbacks?.onSelect).toBeInstanceOf(Function);

      // Call the callback (simulating evaluator selection)
      flowCallbacks?.onSelect?.(mockEvaluators[1]!);
      await vi.advanceTimersByTimeAsync(200);

      // OnlineEvaluationDrawer should update
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
        const nameInput = screen.getByPlaceholderText(
          "Enter evaluation name",
        ) as HTMLInputElement;
        expect(nameInput.value).toBe("Exact Match");
      });
    });
  });

  describe("Evaluation Level selector", () => {
    it("shows Trace Level and Thread Level options", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Trace Level")).toBeInTheDocument();
        expect(screen.getByText("Thread Level")).toBeInTheDocument();
      });
    });

    it("no level is selected by default (progressive disclosure)", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const traceRadio = screen.getByRole("radio", { name: /trace level/i });
        const threadRadio = screen.getByRole("radio", {
          name: /thread level/i,
        });
        expect(traceRadio).not.toBeChecked();
        expect(threadRadio).not.toBeChecked();
      });
    });

    it("shows trace level description", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          screen.getByText(/evaluate each trace individually/i),
        ).toBeInTheDocument();
      });
    });

    it("shows thread level description", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          screen.getByText(/evaluate all traces in a conversation thread/i),
        ).toBeInTheDocument();
      });
    });

    it("allows switching between Trace Level and Thread Level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Initially nothing selected
      const traceRadio = screen.getByRole("radio", { name: /trace level/i });
      const threadRadio = screen.getByRole("radio", { name: /thread level/i });
      expect(traceRadio).not.toBeChecked();
      expect(threadRadio).not.toBeChecked();

      // Select trace level
      await user.click(traceRadio);
      await vi.advanceTimersByTimeAsync(50);
      expect(traceRadio).toBeChecked();
      expect(threadRadio).not.toBeChecked();

      // Switch to Thread Level
      await user.click(threadRadio);
      await waitFor(() => {
        expect(threadRadio).toBeChecked();
        expect(traceRadio).not.toBeChecked();
      });

      // Switch back to Trace Level
      await user.click(traceRadio);
      await waitFor(() => {
        expect(traceRadio).toBeChecked();
        expect(threadRadio).not.toBeChecked();
      });
    });
  });

  describe("Mappings functionality", () => {
    it("includes mappings data in create mutation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select evaluator
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      // Verify mappings is included (may be empty or auto-inferred)
      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          mappings: expect.any(Object),
        }),
      );
    });

    it("includes mappings data in update mutation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      // Wait for data to load (edit mode loads existing monitor with level already set)
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText("Save Changes")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Save Changes"));

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          mappings: expect.any(Object),
        }),
      );
    });
  });

  describe("Pending mappings warning", () => {
    // Note: Testing the full pending mappings flow requires complex setup
    // because it depends on evaluator requiredFields which come from AVAILABLE_EVALUATORS
    // These tests verify the UI elements are rendered correctly when conditions are met

    it("Create button has title tooltip when disabled", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        const createButton = screen.getByText("Create Online Evaluation");
        expect(createButton).toBeDisabled();
      });
    });

    it("shows Evaluation Level field label", async () => {
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Evaluation Level")).toBeInTheDocument();
      });
    });

    it("shows evaluator selection box after selecting level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
    });
  });

  describe("Level change with evaluator selected", () => {
    it("keeps evaluator selected when level changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevel(user, "trace");

      // Select evaluator at trace level
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);
      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Evaluator should remain selected after level change
      const threadRadio = screen.getByRole("radio", { name: /thread/i });
      await user.click(threadRadio);
      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        // Evaluator should still be selected
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
    });
  });
});
