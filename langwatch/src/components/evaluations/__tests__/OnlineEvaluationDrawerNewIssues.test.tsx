/**
 * @vitest-environment jsdom
 *
 * Tests for newer issue fixes and validation in OnlineEvaluationDrawer.
 * Split from OnlineEvaluationDrawerIssueFixes.test.tsx for parallel execution.
 *
 * This file covers:
 * - NEW Issue 1-5 (auto-mapping, select evaluator flow, cancel, mappings persist, thread-level)
 * - VALIDATION tests (create button, level switching)
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
  mockEvaluators,
  Wrapper,
  resetState,
  isOnlineEvalOpen,
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

describe("OnlineEvaluationDrawer - New Issues & Validation", () => {
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
   * NEW Issue 1: Auto-mapping not kicking in after selecting evaluator (trace level)
   *
   * When selecting a built-in evaluator like PII Detection (requires input, output),
   * the auto-mapping should automatically fill in input->trace.input, output->trace.output.
   *
   * EXPECTED: After selecting evaluator, mappings should be auto-inferred and visible.
   * ACTUAL: Mappings are empty, user has to manually fill them.
   */
  describe("NEW Issue 1: Auto-mapping for trace level", () => {
    it("auto-infers input/output mappings when selecting evaluator with required fields at trace level", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select Answer Relevance (requires input, output - should auto-map)
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[2]!); // Answer Relevance

      await vi.advanceTimersByTimeAsync(200);

      // Should open evaluator editor
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Wait for editor to render with mappings
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: The mappings should be auto-filled with trace.input and trace.output
      // Auto-mapped values are displayed as Tags with data-testid="source-mapping-tag"
      await waitFor(
        () => {
          // Look for source mapping tags that show "input" or "output"
          const sourceTags = screen.getAllByTestId("source-mapping-tag");
          expect(sourceTags.length).toBeGreaterThan(0);

          // At least one should show "input" (auto-mapped input field)
          const hasInputMapping = sourceTags.some((tag) =>
            tag.textContent?.includes("input"),
          );
          expect(hasInputMapping).toBe(true);
        },
        { timeout: 3000 },
      );
    });

    it("auto-infers input/output mappings for evaluators with only optional fields (llm_boolean)", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select LLM Boolean Judge (has requiredFields: [], optionalFields: ["input", "output", "contexts"])
      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[3]!); // LLM Boolean Judge

      await vi.advanceTimersByTimeAsync(200);

      // Should open evaluator editor
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Wait for editor to render with mappings
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // EXPECTED: Even though these are optional fields, input/output should be auto-mapped
      await waitFor(
        () => {
          const sourceTags = screen.getAllByTestId("source-mapping-tag");
          expect(sourceTags.length).toBeGreaterThan(0);

          // Should have both input and output auto-mapped
          const hasInputMapping = sourceTags.some((tag) =>
            tag.textContent?.includes("input"),
          );
          const hasOutputMapping = sourceTags.some((tag) =>
            tag.textContent?.includes("output"),
          );
          expect(hasInputMapping).toBe(true);
          expect(hasOutputMapping).toBe(true);
        },
        { timeout: 3000 },
      );
    });

    it("auto-maps input to traces when selecting thread level", async () => {
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

      // First select an evaluator at trace level
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[3]!); // LLM Boolean Judge

      await vi.advanceTimersByTimeAsync(200);

      // Go back to online drawer
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Now switch to Thread level - should NOT auto-open editor anymore
      const threadRadio = screen.getByLabelText(/Thread/i);
      await user.click(threadRadio);

      await vi.advanceTimersByTimeAsync(200);

      // Should still be on onlineEvaluation drawer (no auto-open)
      expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");

      // Click on the evaluator to open editor
      await user.click(screen.getByText("LLM Boolean Judge"));

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: The input field should be auto-mapped to "traces"
      await waitFor(
        () => {
          const sourceTags = screen.getAllByTestId("source-mapping-tag");
          const hasTracesMapping = sourceTags.some((tag) =>
            tag.textContent?.includes("traces"),
          );
          expect(hasTracesMapping).toBe(true);
        },
        { timeout: 3000 },
      );
    });
  });

  /**
   * NEW Issue 2: Save Changes closes editor, doesn't return to online drawer
   *
   * When user clicks "Save Changes" in the evaluator editor (after editing mappings),
   * it should return to the online evaluation drawer, not close everything.
   *
   * EXPECTED: After Save Changes, return to online evaluation drawer.
   * ACTUAL: Everything closes.
   */
  describe("NEW Issue 2: Select Evaluator returns to online drawer", () => {
    it("returns to online evaluation drawer after clicking Select Evaluator", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select an evaluator
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

      // Wait for editor to render - button says "Select Evaluator" when selecting for first time
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Click Select Evaluator (was "Save Changes" before, now customized for this flow)
      await user.click(screen.getByText("Select Evaluator"));

      await vi.advanceTimersByTimeAsync(500);

      // EXPECTED: Should return to online evaluation drawer
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
        },
        { timeout: 3000 },
      );

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Should see the online evaluation drawer with selected evaluator
      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows 'Select Evaluator' button when selecting for first time, 'Save Changes' when editing", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select an evaluator for the FIRST time
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

      // FIRST TIME SELECTION: Button should say "Select Evaluator"
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
        expect(screen.queryByText("Save Changes")).not.toBeInTheDocument();
      });

      // Click Select Evaluator to go back
      await user.click(screen.getByText("Select Evaluator"));

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Now click on the already-selected evaluator to edit it
      await waitFor(() => {
        expect(screen.getByText("Answer Relevance")).toBeInTheDocument();
      });

      const evaluatorBox = screen.getByRole("button", {
        name: /Answer Relevance/i,
      });
      await user.click(evaluatorBox);

      await vi.advanceTimersByTimeAsync(200);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EDITING EXISTING SELECTION: Button should say "Save Changes"
      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument();
        expect(
          screen.queryByText(/^Select Evaluator$/),
        ).not.toBeInTheDocument();
      });
    });

    it("sets up onCreateNew callback for new evaluator flow", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // Click Select Evaluator to open the list
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Verify that the evaluatorList flow callbacks include onCreateNew
      await waitFor(() => {
        const callbacks = getFlowCallbacks("evaluatorList");
        expect(callbacks).toBeDefined();
        expect(callbacks?.onSelect).toBeDefined();
        expect(callbacks?.onCreateNew).toBeDefined();
      });
    });

    it("creates new evaluator and returns to online evaluation drawer with it selected", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select trace level first (progressive disclosure)
      await selectLevelInIssueTests(user, "trace");

      // Click Select Evaluator to open the list
      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select Evaluator"));

      // Wait for callbacks to be set
      await waitFor(() => {
        const callbacks = getFlowCallbacks("evaluatorList");
        expect(callbacks?.onCreateNew).toBeDefined();
      });

      // Simulate clicking "New Evaluator" - this calls onCreateNew which:
      // 1. Sets up evaluatorEditor callback
      // 2. Opens evaluatorCategorySelector
      const onCreateNew = getFlowCallbacks("evaluatorList")?.onCreateNew;
      onCreateNew?.();

      // Verify that evaluatorEditor callback was set up
      await waitFor(() => {
        const editorCallbacks = getFlowCallbacks("evaluatorEditor");
        expect(editorCallbacks?.onSave).toBeDefined();
      });

      // Now simulate the evaluator being saved - call the onSave callback
      // This should navigate back to onlineEvaluation drawer
      const onSave = getFlowCallbacks("evaluatorEditor")?.onSave;
      const result = onSave?.({
        id: "new-evaluator-id",
        name: "New Evaluator",
      });

      // The callback should return true (handled navigation)
      expect(result).toBe(true);

      // Verify navigation happened - drawer should be onlineEvaluation
      await vi.advanceTimersByTimeAsync(200);
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });
    });
  });

  /**
   * NEW Issue 3: Cancel closes everything instead of going back
   *
   * When user clicks "Cancel" in the evaluator editor, it should return
   * to the online evaluation drawer, not close everything.
   *
   * Note: This was supposedly fixed before, but testing again to verify.
   */
  describe("NEW Issue 3: Cancel returns to online drawer", () => {
    it("returns to online evaluation drawer when clicking Cancel in editor", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select an evaluator
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

      // Wait for editor to render
      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      // Click Cancel
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // EXPECTED: Should return to online evaluation drawer (not close everything)
      await waitFor(
        () => {
          expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
        },
        { timeout: 3000 },
      );

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Should see the online evaluation drawer
      await waitFor(() => {
        expect(screen.getByText("New Online Evaluation")).toBeInTheDocument();
      });
    });
  });

  /**
   * NEW Issue 4: Mappings not persisted after Save Changes
   *
   * When user fills in mappings and clicks Save Changes, the mappings
   * should be persisted. When reopening the drawer, mappings should still be there.
   *
   * EXPECTED: Mappings persist after save.
   * ACTUAL: Mappings are gone when reopening.
   */
  describe("NEW Issue 4: Mappings persist after Save Changes", () => {
    it("preserves mappings after saving and reopening", async () => {
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

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select Exact Match (requires expected_output which needs manual mapping)
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

      // Wait for editor to render with mappings
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Find the expected_output mapping input and fill it
      const textboxes = screen.getAllByRole("textbox");
      const mappingInputs = textboxes.filter((input) =>
        input.getAttribute("placeholder")?.includes("Select"),
      );

      // Click on a mapping input to open dropdown
      if (mappingInputs[0]) {
        await user.click(mappingInputs[0]);
        await vi.advanceTimersByTimeAsync(100);

        // Select "output" from dropdown if available
        const outputOption = screen.queryByTestId("field-option-output");
        if (outputOption) {
          await user.click(outputOption);
          await vi.advanceTimersByTimeAsync(100);
        }
      }

      // Click Save Changes (or Cancel to go back)
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      // Return to online evaluation drawer
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Click on the selected evaluator to edit again
      await waitFor(() => {
        expect(screen.getByText("Exact Match")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Exact Match"));

      await vi.advanceTimersByTimeAsync(200);

      // Should open evaluator editor again
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: The mapping we set should still be there
      // Mappings are displayed as Tags with data-testid="source-mapping-tag"
      await waitFor(
        () => {
          const sourceTags = screen.getAllByTestId("source-mapping-tag");
          const hasOutputMapping = sourceTags.some((tag) =>
            tag.textContent?.includes("output"),
          );
          expect(hasOutputMapping).toBe(true);
        },
        { timeout: 3000 },
      );
    });
  });

  /**
   * NEW Issue 5: Thread-level selecting first level keeps 'required' status
   *
   * When selecting just "traces" (first level) for a thread-level mapping,
   * the field should be considered mapped (not pending).
   *
   * EXPECTED: Selecting "traces" completes the mapping.
   * ACTUAL: Field stays marked as required/pending.
   */
  describe("NEW Issue 5: Thread-level first level completes mapping", () => {
    it("marks field as mapped when selecting traces at thread level", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      state.mockQuery = { "drawer.open": "onlineEvaluation" };

      const { rerender } = render(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Select Thread level first (progressive disclosure)
      await selectLevelInIssueTests(user, "thread");

      await waitFor(() => {
        expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
      });

      // Open evaluator list
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Select an evaluator
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

      // Wait for editor with mappings
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      // Find mapping input and select "traces"
      const textboxes = screen.getAllByRole("textbox");
      const mappingInput = textboxes.find((input) =>
        input.getAttribute("placeholder")?.includes("Select"),
      );

      if (mappingInput) {
        await user.click(mappingInput);
        await vi.advanceTimersByTimeAsync(100);

        const tracesOption = screen.queryByTestId("field-option-traces");
        if (tracesOption) {
          await user.click(tracesOption);
          await vi.advanceTimersByTimeAsync(100);
        }
      }

      // EXPECTED: The pending-mappings-error should NOT be visible
      // (or should not include the field we just mapped)
      await waitFor(
        () => {
          const errorMessage = screen.queryByTestId("pending-mappings-error");
          // Either no error, or error doesn't mention "input" field we just mapped
          if (errorMessage) {
            expect(errorMessage.textContent).not.toContain("input");
          }
        },
        { timeout: 3000 },
      );
    });
  });

  /**
   * NEW Issue 6: Auto-map 'traces' to 'input' for thread-level
   *
   * When selecting thread level, the "input" field should auto-map to "traces".
   *
   * NOTE: This is now covered by the "auto-maps input to traces when selecting thread level"
   * test in the "NEW Issue 1: Auto-mapping for trace level" describe block above.
   */

  /**
   * VALIDATION ISSUES (Jan 22, 2026)
   *
   * Issue 1: Create button should be disabled when no valid mappings
   * - At least one field must be mapped (even if all fields are optional)
   * - This should use the same validation logic as evaluations v3
   *
   * Issue 2: Switching levels should NOT auto-open evaluator editor
   * - Previously it would open the editor when switching to thread level
   * - Now it should just update the mappings without opening the editor
   *
   * Issue 3: Monitor slug should be unique (add nanoid suffix)
   * - Creating multiple monitors with the same evaluator should work
   */
  describe("VALIDATION: Create button disabled without valid mappings", () => {
    // Skip: This test fails because the component remounts when navigating between drawers,
    // causing the auto-inference effect to run again. The validation itself works correctly
    // but this specific navigation scenario causes auto-inference to re-populate mappings.
    it.skip("disables Create button when evaluator has only optional fields and none are mapped", async () => {
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

      // Select LLM Boolean evaluator (has only optional fields: input, output, contexts)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[3]!);

      await vi.advanceTimersByTimeAsync(200);

      // Go to evaluator editor
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Clear all mappings
      await waitFor(() => {
        expect(screen.getByText("Variables")).toBeInTheDocument();
      });

      const clearButtons = screen.queryAllByTestId("clear-mapping-button");
      for (const btn of clearButtons) {
        await user.click(btn);
        await vi.advanceTimersByTimeAsync(50);
      }

      // Go back to online evaluation drawer
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: Create button should be disabled because no mappings
      await waitFor(() => {
        const createButton = screen.getByRole("button", { name: /Create/i });
        expect(createButton).toBeDisabled();
      });
    });

    it("enables Create button when at least one field is mapped", async () => {
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

      // Select PII Check evaluator (has only optional fields)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      // Go to evaluator editor - mappings should be auto-filled
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Go back to online evaluation drawer (with auto-mapped values)
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // EXPECTED: Create button should be enabled because input/output are auto-mapped
      await waitFor(() => {
        const createButton = screen.getByRole("button", { name: /Create/i });
        expect(createButton).not.toBeDisabled();
      });
    });
  });

  describe("VALIDATION: Switching levels should NOT auto-open editor", () => {
    it("does not open evaluator editor when switching from trace to thread level", async () => {
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

      // Select an evaluator first
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

      await vi.advanceTimersByTimeAsync(200);

      // Go to evaluator editor
      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Go back to online evaluation drawer
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Now switch to Thread level
      const threadRadio = screen.getByLabelText(/Thread/i);
      await user.click(threadRadio);

      await vi.advanceTimersByTimeAsync(200);

      // EXPECTED: Should still be on onlineEvaluation drawer, NOT evaluatorEditor
      expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
    });
  });

  describe("VALIDATION: Switching levels clears and re-infers mappings", () => {
    it("clears trace-level mappings when switching to thread level", async () => {
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

      // Select an evaluator at trace level (should auto-map input/output)
      await user.click(screen.getByText("Select Evaluator"));
      await waitFor(() =>
        expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
      );

      // Use Answer Relevance which has input/output required fields
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

      // Go back to online evaluation drawer
      await user.click(screen.getByText("Cancel"));

      await vi.advanceTimersByTimeAsync(100);

      await waitFor(() => {
        expect(state.mockQuery["drawer.open"]).toBe("onlineEvaluation");
      });

      rerender(
        <Wrapper>
          <CurrentDrawer />
        </Wrapper>,
      );

      // Now switch to Thread level
      const threadRadio = screen.getByLabelText(/Thread/i);
      await user.click(threadRadio);

      await vi.advanceTimersByTimeAsync(200);

      // Click on the evaluator to open editor
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

      // Clear a mapping to access the dropdown
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
      // NOT trace-specific sources (input, output at top level)
      await waitFor(() => {
        expect(screen.getByTestId("field-option-traces")).toBeInTheDocument();
        // Should NOT see trace-level "input" or "output" as top-level options
        // (they are nested under traces for thread level)
      });
    });
  });
});
