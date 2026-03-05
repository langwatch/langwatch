/**
 * @vitest-environment jsdom
 *
 * Feature tests for OnlineEvaluationDrawer.
 * Split from OnlineEvaluationDrawerIssueFixes.test.tsx for parallel execution.
 *
 * This file covers:
 * - Thread idle timeout feature
 * - License enforcement
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
  mockCheckAndProceed,
  mockOpenUpgradeModal,
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

describe("OnlineEvaluationDrawer - Features", () => {
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
   * Thread Idle Timeout feature tests
   *
   * This feature adds a dropdown to thread-level evaluations that allows users
   * to configure how long to wait after the last message before running evaluation.
   */
  describe("Thread Idle Timeout feature", () => {
    /**
     * Helper to select evaluation level in thread timeout tests
     */
    const selectLevelInTimeoutTests = async (
      user: ReturnType<typeof userEvent.setup>,
      level: "trace" | "thread" = "trace",
    ) => {
      const levelLabel = level === "trace" ? /Trace Level/i : /Thread Level/i;
      await waitFor(() => {
        expect(screen.getByLabelText(levelLabel)).toBeInTheDocument();
      });
      await user.click(screen.getByLabelText(levelLabel));
    };

    it("does not show thread idle timeout dropdown for trace level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select trace level
      await selectLevelInTimeoutTests(user, "trace");

      // Select an evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Simulate evaluator selection via callback
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Should NOT see the thread idle timeout dropdown
      await waitFor(() => {
        expect(
          screen.queryByText(/Conversation Idle Time/i),
        ).not.toBeInTheDocument();
      });
    });

    it("shows thread idle timeout dropdown for thread level after selecting evaluator", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select thread level
      await selectLevelInTimeoutTests(user, "thread");

      // Select an evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Simulate evaluator selection via callback
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Should see the thread idle timeout dropdown
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });
    });

    it("thread idle timeout dropdown has correct options", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select thread level and evaluator
      await selectLevelInTimeoutTests(user, "thread");
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for dropdown to appear
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });

      // Check dropdown has correct options
      const dropdown = screen.getByRole("combobox") as HTMLSelectElement;
      const options = Array.from(dropdown.options).map((opt) => opt.text);

      expect(options).toContain("Disabled - evaluate on every trace");
      expect(options).toContain("1 minute");
      expect(options).toContain("5 minutes");
      expect(options).toContain("10 minutes");
      expect(options).toContain("15 minutes");
      expect(options).toContain("30 minutes");
    });

    it("defaults to 5 minutes (300 seconds) for thread idle timeout", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select thread level and evaluator
      await selectLevelInTimeoutTests(user, "thread");
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for dropdown to appear
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });

      // Check default value is 300 (5 minutes)
      const dropdown = screen.getByRole("combobox") as HTMLSelectElement;
      expect(dropdown.value).toBe("300");
    });

    it("allows changing thread idle timeout value", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select thread level and evaluator
      await selectLevelInTimeoutTests(user, "thread");
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for dropdown to appear
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });

      // Change to 10 minutes (600 seconds) - default is 5 minutes (300)
      const dropdown = screen.getByRole("combobox") as HTMLSelectElement;
      await user.selectOptions(dropdown, "600");

      // Verify value changed
      await waitFor(() => {
        expect(dropdown.value).toBe("600");
      });
    });

    it("includes threadIdleTimeout in create mutation payload for thread level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select thread level
      await selectLevelInTimeoutTests(user, "thread");

      // Select evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for form to be ready
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });

      // Set timeout to 10 minutes (600 seconds) - default is 5 minutes
      const dropdown = screen.getByRole("combobox") as HTMLSelectElement;
      await user.selectOptions(dropdown, "600");

      // Click save
      const saveButton = screen.getByText("Create Online Evaluation");
      await user.click(saveButton);

      // Verify mutation was called with threadIdleTimeout
      await waitFor(() => {
        expect(mockCreateMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            threadIdleTimeout: 600,
          }),
        );
      });
    });

    it("sends null threadIdleTimeout for trace level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Select trace level
      await selectLevelInTimeoutTests(user, "trace");

      // Select evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for form to be ready
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Click save
      const saveButton = screen.getByText("Create Online Evaluation");
      await user.click(saveButton);

      // Verify mutation was called with null threadIdleTimeout
      await waitFor(() => {
        expect(mockCreateMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            threadIdleTimeout: null,
          }),
        );
      });
    });

    it("hides thread idle timeout dropdown when switching from thread to trace level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      // Start with thread level
      await selectLevelInTimeoutTests(user, "thread");

      // Select evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Verify dropdown is visible
      await waitFor(() => {
        expect(screen.getByText(/Conversation Idle Time/i)).toBeInTheDocument();
      });

      // Switch to trace level
      await user.click(screen.getByLabelText(/Trace Level/i));

      // Dropdown should now be hidden
      await waitFor(() => {
        expect(
          screen.queryByText(/Conversation Idle Time/i),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("License Enforcement", () => {

    /**
     * Helper to select evaluation level
     */
    const selectLevelInLicenseTests = async (
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

    it("allows creating online evaluation when under limit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockCreateMutate.mockClear();
      mockOpenUpgradeModal.mockClear();
      mockCheckAndProceed.mockClear();

      // Set limit check to allow creation
      state.mockLicenseIsAllowed = true;

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevelInLicenseTests(user, "trace");

      // Select evaluator with auto-inferred mapping
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      // Wait for Create button to be enabled
      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      // Verify checkAndProceed was called
      expect(mockCheckAndProceed).toHaveBeenCalled();
      // Verify mutation was called (allowed)
      expect(mockCreateMutate).toHaveBeenCalled();
      // Verify upgrade modal was NOT shown
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
    });

    it("shows upgrade modal when creating online evaluation at limit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockCreateMutate.mockClear();
      mockOpenUpgradeModal.mockClear();
      mockCheckAndProceed.mockClear();

      // Set limit check to block creation
      state.mockLicenseIsAllowed = false;

      render(<OnlineEvaluationDrawer open={true} />, { wrapper: Wrapper });

      await selectLevelInLicenseTests(user, "trace");

      // Select evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      // Wait for Create button to be enabled
      await waitFor(() => {
        expect(screen.getByText("Create Online Evaluation")).not.toBeDisabled();
      });

      await user.click(screen.getByText("Create Online Evaluation"));

      // Verify checkAndProceed was called
      expect(mockCheckAndProceed).toHaveBeenCalled();
      // Verify mutation was NOT called (blocked)
      expect(mockCreateMutate).not.toHaveBeenCalled();
      // Verify upgrade modal was shown
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith(
        "onlineEvaluations",
        3,
        3,
      );
    });

    it("allows updating online evaluation regardless of limit status", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockUpdateMutate.mockClear();
      mockOpenUpgradeModal.mockClear();
      mockCheckAndProceed.mockClear();

      // Set limit check to block creation (but update should still work)
      state.mockLicenseIsAllowed = false;

      // Open drawer in edit mode with existing monitor
      render(<OnlineEvaluationDrawer open={true} monitorId="monitor-1" />, {
        wrapper: Wrapper,
      });

      // Wait for monitor data to load and populate the form
      await waitFor(() => {
        expect(screen.getByDisplayValue("My PII Monitor")).toBeInTheDocument();
      });

      // The Save Changes button should be visible (edit mode)
      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument();
      });

      // Modify the name to enable save
      const nameInput = screen.getByDisplayValue("My PII Monitor");
      await user.clear(nameInput);
      await user.type(nameInput, "Updated PII Monitor");

      await user.click(screen.getByText("Save Changes"));

      // Verify checkAndProceed was NOT called (update bypasses limit check)
      expect(mockCheckAndProceed).not.toHaveBeenCalled();
      // Verify update mutation was called (allowed even when at limit)
      expect(mockUpdateMutate).toHaveBeenCalled();
      // Verify upgrade modal was NOT shown (update bypasses limit check)
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
    });
  });
});
