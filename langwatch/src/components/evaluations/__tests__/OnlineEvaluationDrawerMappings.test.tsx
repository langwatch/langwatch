/**
 * @vitest-environment jsdom
 *
 * Integration tests for OnlineEvaluationDrawer + EvaluatorEditorDrawer mapping flow.
 * Only tRPC endpoints are mocked - drawer system works naturally.
 *
 * This file covers:
 * - OnlineEvaluationDrawer + EvaluatorEditorDrawer Mapping Integration
 *   (trace field mapping, nested fields, span subfields)
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
import { clearOnlineEvaluationDrawerState } from "../OnlineEvaluationDrawer";
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
 * INTEGRATION TEST: OnlineEvaluationDrawer + EvaluatorEditorDrawer
 *
 * This tests the full flow where:
 * 1. User opens OnlineEvaluationDrawer
 * 2. User selects an evaluator with required mappings
 * 3. EvaluatorEditorDrawer opens for mapping configuration
 * 4. User clicks on mapping input and sees trace fields
 * 5. User selects a nested field (e.g., metadata.thread_id)
 */
describe("OnlineEvaluationDrawer + EvaluatorEditorDrawer Mapping Integration", () => {
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
   * Helper to select evaluation level in integration tests
   */
  const selectLevelInIntegration = async (
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

  it("INTEGRATION: shows trace mapping dropdown with nested fields when configuring evaluator", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Start with online evaluation drawer open
    state.mockQuery = { "drawer.open": "onlineEvaluation" };

    const { rerender } = render(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 1: Select level first (progressive disclosure)
    await selectLevelInIntegration(user, "trace");

    // Step 2: OnlineEvaluationDrawer shows evaluator selection
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });

    // Step 3: Click "Select Evaluator" and select via flow callback
    await user.click(screen.getByText("Select Evaluator"));
    await waitFor(() =>
      expect(getFlowCallbacks("evaluatorList")).toBeDefined(),
    );

    // Select PII Check evaluator
    getFlowCallbacks("evaluatorList")?.onSelect?.(mockEvaluators[0]!);

    // Step 4: Wait for navigation to evaluator editor (Issue 1 fix)
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(
      () => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      },
      { timeout: 500 },
    );

    // Step 4: Re-render to pick up the new URL state
    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Step 5: Find a mapping input in the evaluator editor
    await waitFor(() => {
      expect(screen.getByText("Variables")).toBeInTheDocument();
    });

    // Step 6: With auto-mapping, input/output should already be mapped
    // First, clear one of the existing mappings to test the dropdown
    const clearButtons = screen.getAllByTestId("clear-mapping-button");
    expect(clearButtons.length).toBeGreaterThan(0);

    // Click the clear button on the first mapping
    await user.click(clearButtons[0]!);

    await vi.advanceTimersByTimeAsync(100);

    // Step 7: Now click on the empty mapping input to open dropdown
    const textboxes = screen.getAllByRole("textbox");
    // Find the mapping input (not the name input) - look for one with placeholder
    const mappingInput =
      textboxes.find(
        (tb) =>
          tb.getAttribute("placeholder")?.includes("source") ||
          tb.getAttribute("placeholder")?.includes("Required") ||
          tb.getAttribute("placeholder") === "",
      ) ?? textboxes[1]; // Skip the name input (first one)

    await user.click(mappingInput!);

    // Step 8: Should show trace fields in dropdown
    await waitFor(
      () => {
        const fieldOptions = screen.queryAllByTestId(/^field-option-/);
        expect(fieldOptions.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    // Step 9: Click on "metadata" (has children)
    await waitFor(() => {
      expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("field-option-metadata"));

    // Step 10: Should show metadata badge AND nested children
    await waitFor(() => {
      expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent(
        "metadata",
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("field-option-thread_id")).toBeInTheDocument();
    });

    // Step 11: Click on thread_id to complete the mapping
    await user.click(screen.getByTestId("field-option-thread_id"));

    // Step 12: Should show completed mapping as "metadata.thread_id"
    await waitFor(() => {
      const sourceTags = screen.getAllByTestId("source-mapping-tag");
      // Should have at least one mapping tag (we cleared one, so should have 1 remaining + the new one)
      expect(sourceTags.length).toBeGreaterThan(0);
      // One of them should show "metadata.thread_id"
      const hasMetadataMapping = sourceTags.some((tag) =>
        tag.textContent?.includes("metadata.thread_id"),
      );
      expect(hasMetadataMapping).toBe(true);
    });
  });

  it("INTEGRATION: selecting spans shows nested span subfields", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Start with online evaluation drawer open
    state.mockQuery = { "drawer.open": "onlineEvaluation" };

    const { rerender } = render(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    // Select level first (progressive disclosure)
    await selectLevelInIntegration(user, "trace");

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

    await waitFor(
      () => {
        expect(state.mockQuery["drawer.open"]).toBe("evaluatorEditor");
      },
      { timeout: 500 },
    );

    rerender(
      <Wrapper>
        <CurrentDrawer />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Variables")).toBeInTheDocument();
    });

    // With auto-mapping, input/output are already mapped. Clear one first.
    const clearButtons = screen.getAllByTestId("clear-mapping-button");
    expect(clearButtons.length).toBeGreaterThan(0);
    await user.click(clearButtons[0]!);

    await vi.advanceTimersByTimeAsync(100);

    const textboxes = screen.getAllByRole("textbox");
    const mappingInput =
      textboxes.find(
        (tb) =>
          tb.getAttribute("placeholder")?.includes("source") ||
          tb.getAttribute("placeholder")?.includes("Required") ||
          tb.getAttribute("placeholder") === "",
      ) ?? textboxes[1]; // Skip the name input

    await user.click(mappingInput!);

    await waitFor(
      () => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Click on "spans"
    await user.click(screen.getByTestId("field-option-spans"));

    // Should show spans badge AND nested children (span names)
    await waitFor(() => {
      expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent(
        "spans",
      );
    });

    // With the new two-level selection, spans first shows "* (any span)" and dynamic span names
    // The name "*" is used for "Any span" option
    await waitFor(() => {
      // "* (any span)" option has name "*", so testid is "field-option-*"
      expect(screen.getByTestId("field-option-*")).toBeInTheDocument();
    });

    // Click on "* (any span)" to see the span subfields
    await user.click(screen.getByTestId("field-option-*"));

    // Now should show span subfields: input, output, params, contexts
    await waitFor(() => {
      expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
    });

    // Select output
    await user.click(screen.getByTestId("field-option-output"));

    // Should show completed mapping (spans.*.output)
    await waitFor(() => {
      const sourceTags = screen.getAllByTestId("source-mapping-tag");
      expect(sourceTags.length).toBeGreaterThan(0);
      const hasSpansOutputMapping = sourceTags.some((tag) =>
        tag.textContent?.includes("spans") && tag.textContent?.includes("output"),
      );
      expect(hasSpansOutputMapping).toBe(true);
    });
  });
});
