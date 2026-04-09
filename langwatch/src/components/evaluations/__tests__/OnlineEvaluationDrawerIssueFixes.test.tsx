/**
 * @vitest-environment jsdom
 *
 * Issue-specific integration tests for OnlineEvaluationDrawer.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 *
 * This file covers:
 * - Original issue fixes (editor always opens, click selected evaluator, create new evaluator flow)
 * - Auto-inference of mappings
 * - Cancel/navigation behavior
 * - Thread level nested fields
 * - Level switching updates sources
 * - Validation messages (red validation, pending warnings)
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CurrentDrawer } from "~/components/CurrentDrawer";
import { EvaluatorEditorDrawer } from "~/components/evaluators/EvaluatorEditorDrawer";
import { EvaluatorListDrawer } from "~/components/evaluators/EvaluatorListDrawer";
import {
  clearDrawerStack,
  clearFlowCallbacks,
  getDrawerStack,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import {
  clearOnlineEvaluationDrawerState,
  OnlineEvaluationDrawer,
} from "../OnlineEvaluationDrawer";
import {
  state,
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
 * ISSUE-SPECIFIC INTEGRATION TESTS
 *
 * These tests verify the expected behaviors for the 4 reported issues.
 * They should FAIL initially and pass after fixes are implemented.
 */
describe("OnlineEvaluationDrawer Issue Fixes", () => {
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

  // Helper functions for drawer state
  const isOnlineEvalOpen = () =>
    state.mockQuery["drawer.open"] === "onlineEvaluationDrawer" ||
    state.mockQuery["drawer.open"] === undefined ||
    !state.mockQuery["drawer.open"];
  const isEvaluatorListOpen = () =>
    state.mockQuery["drawer.open"] === "evaluatorList";

  /**
   * Helper to select evaluation level in issue fix tests
   */
  const selectLevelInIssueTests = async (
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

  /**
   * ISSUE 1: Always open evaluator editor after selection
   *
   * Current behavior: Only opens editor when there are pending mappings
   * Expected behavior: ALWAYS open the editor so user can see/edit settings
   */
  describe("Issue 1: Always open evaluator editor after selection", () => {
    it("opens evaluator editor after selecting an evaluator at trace level (even without pending mappings)", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      const { rerender } = render(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // Click Select Evaluator
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Navigate to evaluator list
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorList");
      });

      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>,
      );

      // Select PII Check evaluator
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });
      const piiCheckCard = screen.getByTestId("evaluator-card-evaluator-1");
      await user.click(piiCheckCard);

      // Wait for navigation
      await vi.advanceTimersByTimeAsync(200);

      // EXPECTED: Evaluator editor should open (drawer.open should be "evaluatorEditor")
      // This is the fix - always open editor, not just when pending mappings
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
        },
        { timeout: 1000 },
      );
    });
  });

  /**
   * ISSUE 2: Click selected evaluator should open editor (not list)
   *
   * Current behavior: Clicking selected evaluator goes to evaluator list
   * Expected behavior: Should open evaluator editor with back button to list
   */
  describe("Issue 2: Click selected evaluator opens editor with back to list", () => {
    it("clicking on already-selected evaluator opens editor (not list)", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      const { rerender } = render(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
          <EvaluatorListDrawer open={false} />
          <EvaluatorEditorDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // First, select an evaluator via flow callback
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for evaluator to be selected and editor to open (Issue 1 fix)
      await vi.advanceTimersByTimeAsync(200);

      // The editor should have opened
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
        },
        { timeout: 500 },
      );

      // Simulate closing the editor (user goes back to online drawer)
      state.mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      // IMPORTANT: Rerender to reflect the new URL state
      rerender(
        <Wrapper>
          <OnlineEvaluationDrawer open={true} />
          <EvaluatorListDrawer open={false} />
          <EvaluatorEditorDrawer />
        </Wrapper>,
      );

      // Online drawer should still show with PII Check selected
      await waitFor(() => {
        expect(screen.getByText("PII Check")).toBeInTheDocument();
      });

      // Now click on the selected evaluator box again
      // This should open the editor directly (not the list)
      const evaluatorBox = screen.getByRole("button", { name: /PII Check/i });
      await user.click(evaluatorBox);

      // EXPECTED: Should open evaluatorEditor directly (not evaluatorList)
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
        },
        { timeout: 1000 },
      );
    });
  });

  /**
   * ISSUE 3: Creating new evaluator should return to online drawer with selection
   *
   * Current behavior: Everything closes after creating a new evaluator
   * Expected behavior: Should return to OnlineEvaluationDrawer with new evaluator selected
   *
   * This tests the flow callback mechanism - when EvaluatorEditorDrawer calls onSave,
   * the OnlineEvaluationDrawer should receive the new evaluator and select it.
   */
  describe("Issue 3: Creating new evaluator returns to online drawer", () => {
    it("flow callback onSelect is called when new evaluator is created from evaluator editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluationDrawer" };

      render(
        <Wrapper>
          <OnlineEvaluationDrawer open={isOnlineEvalOpen()} />
          <EvaluatorListDrawer open={isEvaluatorListOpen()} />
          <EvaluatorEditorDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // Click Select Evaluator to set up flow callbacks
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Verify flow callbacks are set
      await waitFor(() => {
        expect(getFlowCallbacks("evaluatorList")).toBeDefined();
      });

      const flowCallbacks = getFlowCallbacks("evaluatorList");

      // EXPECTED: The onSelect callback should be set up to receive new evaluators
      // When EvaluatorEditorDrawer saves, it should trigger this callback
      expect(flowCallbacks?.onSelect).toBeInstanceOf(Function);

      // Simulate what should happen when a new evaluator is created:
      // The EvaluatorEditorDrawer should call the flow callback with the new evaluator
      const newEvaluator = {
        ...mockEvaluators[0]!,
        id: "new-evaluator-123",
        name: "My New Evaluator",
      };

      // Call the callback as if the editor saved a new evaluator
      flowCallbacks?.onSelect?.(newEvaluator as any);
      await vi.advanceTimersByTimeAsync(200);

      // EXPECTED: OnlineEvaluationDrawer should now show the new evaluator selected
      await waitFor(
        () => {
          expect(screen.getByText("My New Evaluator")).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });
  });

  /**
   * ISSUE 4: Mapping section should show when creating new evaluator
   *
   * Current behavior: Mapping section doesn't appear when creating new evaluator
   * Expected behavior: Should show mapping section with available trace/thread sources
   *
   * The mappingsConfig should be passed to EvaluatorEditorDrawer so it can show
   * the mapping UI with trace/thread sources.
   */
  describe("Issue 4: Mapping section shows when creating new evaluator", () => {
    it("evaluator editor shows mapping section with trace sources when opened from online drawer", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      // Start with online evaluation drawer open
      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // Wait for drawer to render
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Select an evaluator (this should open the editor with mappings)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select PII Check which has required "input" field
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      // Wait for navigation to evaluator editor (Issue 1 fix ensures this happens)
      await vi.advanceTimersByTimeAsync(200);

      // Verify the editor opened (URL changed)
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
        },
        { timeout: 500 },
      );

      // Rerender to pick up the new URL state
      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: Should see "Variables" section in the editor
      // This section shows the mapping inputs for evaluator required fields
      await waitFor(
        () => {
          expect(screen.getByText("Variables")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // EXPECTED: Should see mapping inputs for required fields (like "input")
      // These should be VariableMappingInput components with trace sources
      await waitFor(() => {
        // Look for a mapping input field
        const mappingInputs = screen.getAllByRole("textbox");
        // Should have at least one mapping input (for "input" field)
        expect(mappingInputs.length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // NEW ISSUE TESTS - These should FAIL initially, then pass after fixes
  // ============================================================================

  /**
   * Issue: Auto-inference of mappings not working for trace level
   *
   * When selecting an evaluator with required input/output fields at trace level,
   * these should be auto-inferred from trace.input and trace.output.
   *
   * EXPECTED: After selecting evaluator, mappings should be pre-filled.
   * ACTUAL: Mappings are empty.
   */
  describe("Issue: Auto-inference of mappings for trace level", () => {
    it("auto-infers input/output mappings when selecting evaluator with required fields", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select Answer Relevance (has required input/output)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: Should see auto-inferred mappings (badge showing "input" or "trace.input")
      await waitFor(
        () => {
          const mappingBadges = screen.queryAllByTestId("source-mapping-tag");
          // Should have at least one auto-inferred mapping
          expect(mappingBadges.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );
    });
  });

  /**
   * Issue: Cancel on evaluator editor closes everything instead of going back
   *
   * EXPECTED: Clicking Cancel returns to OnlineEvaluationDrawer.
   * ACTUAL: Clicking Cancel closes all drawers.
   */
  describe("Issue: Cancel should go back, not close everything", () => {
    it("clicking Cancel in evaluator editor returns to online evaluation drawer", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Check drawer stack has multiple entries (can go back)
      expect(getDrawerStack().length).toBeGreaterThan(1);

      // Click Cancel
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // EXPECTED: Should return to online evaluation drawer (not close everything)
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
        },
        { timeout: 1000 },
      );

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: Thread level doesn't show thread-specific nested fields
   *
   * EXPECTED: Thread level shows "traces" with nested input/output/etc options.
   * ACTUAL: Only shows flat thread_id and traces options.
   */
  describe("Issue: Thread level nested fields", () => {
    it("thread level shows nested fields for traces mapping", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select thread level first (progressive disclosure)
      await selectLevelInIssueTests(user, "thread");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes[1];
      await user.click(mappingInput!);

      // Click on traces
      await waitFor(() => {
        expect(screen.getByTestId("field-option-traces")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("field-option-traces"));

      // EXPECTED: Should show nested options (input, output, etc.)
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent(
          "traces",
        );
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: Switching trace->thread doesn't update available sources
   *
   * EXPECTED: After switching to thread, mappings show thread sources.
   * ACTUAL: Mappings still show trace sources.
   *
   * NOTE: Switching levels no longer auto-opens the editor (per user request).
   * User must click on the evaluator to open the editor.
   */
  describe("Issue: Switching levels updates available sources", () => {
    it("switching from trace to thread updates mapping sources in editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // First select evaluator at trace level
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Go back (via Cancel which should use goBack)
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
        },
        { timeout: 1000 },
      );

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Switch to thread level - should NOT auto-open editor anymore
      const threadRadio = screen.getByLabelText(/thread level/i);
      await user.click(threadRadio);

      await vi.advanceTimersByTimeAsync(200);

      // Should still be on onlineEvaluation drawer
      expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");

      // Now click on the evaluator to open editor
      await user.click(screen.getByText("Answer Relevance"));

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Clear a mapping first to get the dropdown
      const clearButtons = screen.queryAllByTestId("clear-mapping-button");
      if (clearButtons[0]) {
        await user.click(clearButtons[0]);
        await vi.advanceTimersByTimeAsync(100);
      }

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes.find((input) =>
        input.getAttribute("placeholder")?.includes("Select"),
      );
      if (mappingInput) {
        await user.click(mappingInput);
      }

      // EXPECTED: Should see thread-specific sources (thread_id, traces)
      // NOT trace-specific sources (metadata, spans at top level)
      await waitFor(() => {
        expect(
          screen.getByTestId("field-option-thread_id"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("field-option-traces")).toBeInTheDocument();
        // Should NOT see trace-specific sources at top level
        expect(
          screen.queryByTestId("field-option-metadata"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("field-option-spans"),
        ).not.toBeInTheDocument();
      });
    });
  });

  /**
   * Issue: "threads" option showing in trace-level sources
   *
   * EXPECTED: Trace level doesn't show "threads" option.
   * ACTUAL: "threads" is shown as an option.
   */
  describe("Issue: Remove threads from trace-level sources", () => {
    it("trace level mapping does not show threads option", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(
        () => {
          expect(screen.getByText("Variables")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Click on a mapping input
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes[1];
      await user.click(mappingInput!);

      // Wait for dropdown options
      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      });

      // EXPECTED: Should NOT see "threads" option at trace level
      expect(
        screen.queryByTestId("field-option-threads"),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * Issue 2: Red validation message for pending mappings
   *
   * When there are required fields that cannot be auto-inferred (like expected_output),
   * there should be a clear red validation message, not just yellow highlighting.
   *
   * EXPECTED: Red text message below the mapping inputs.
   * ACTUAL: Only yellow border, easy to miss.
   */
  describe("Issue 2: Red validation message for pending mappings", () => {
    it("shows red validation message when required fields are not mapped", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select Exact Match (requires expected_output which can't be auto-inferred)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: Should see a red validation message about missing mappings
      await waitFor(
        () => {
          const validationMessage = screen.getByTestId(
            "missing-mappings-error",
          );
          expect(validationMessage).toBeInTheDocument();
          expect(validationMessage).toHaveTextContent(/required|mapping/i);
        },
        { timeout: 3000 },
      );
    });
  });

  /**
   * Issue 6: Pending warning when returning without completing mappings
   *
   * When user goes to evaluator editor, doesn't complete mappings, and returns,
   * the online evaluation drawer should show a warning about pending mappings.
   *
   * EXPECTED: Warning banner visible in online evaluation drawer.
   */
  describe("Issue 6: Pending warning when returning without completing", () => {
    it("shows pending mapping warning in online drawer when returning from editor", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select Exact Match (requires expected_output which can't be auto-inferred)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[1]!);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Wait for editor to render
      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Don't complete the mappings, just go back
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // Should return to online evaluation drawer
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: Should see warning about pending mappings
      await waitFor(() => {
        // Look for the warning banner
        expect(screen.getByText(/need.*mapping/i)).toBeInTheDocument();
        // Should have a "Configure" button
        expect(
          screen.getByRole("button", { name: /configure/i }),
        ).toBeInTheDocument();
      });
    });
  });
});
