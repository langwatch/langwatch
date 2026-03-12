/**
 * @vitest-environment jsdom
 *
 * Integration tests for OnlineEvaluationDrawer preconditions behavior.
 *
 * This file covers:
 * - Collapsed default state (default origin=application precondition)
 * - Expanding preconditions form
 * - Field selector with all fields grouped by category
 * - Rule dropdown filtering per field
 * - Boolean field selector for traces.error
 * - Collapsing back when removing custom preconditions
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  (
    await import("./OnlineEvaluationDrawer.test-helpers.tsx")
  ).createUpgradeModalMock(),
);
vi.mock("~/hooks/useLicenseEnforcement", async () =>
  (
    await import("./OnlineEvaluationDrawer.test-helpers.tsx")
  ).createLicenseEnforcementMock(),
);

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = vi.fn();

describe("<OnlineEvaluationDrawer /> preconditions", () => {
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
   * Helper to select evaluation level and evaluator so preconditions section is visible
   */
  const setupWithEvaluator = async (
    user: ReturnType<typeof userEvent.setup>,
  ) => {
    const { rerender } = render(<OnlineEvaluationDrawer open={true} />, {
      wrapper: Wrapper,
    });

    // Select trace level
    await waitFor(() => {
      expect(screen.getByLabelText(/Trace Level/i)).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(/Trace Level/i));
    await vi.advanceTimersByTimeAsync(50);

    // Select evaluator via flow callback
    await waitFor(() => {
      expect(screen.getByText("Select Evaluator")).toBeInTheDocument();
    });
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

    // Verify preconditions section is visible
    await waitFor(() => {
      expect(screen.getByText(/Preconditions/)).toBeInTheDocument();
    });

    return { rerender };
  };

  describe("when default preconditions are active", () => {
    it("shows collapsed summary text", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      await waitFor(() => {
        expect(
          screen.getByText(
            "This evaluation will run on every application trace",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows Add Precondition button", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      await waitFor(() => {
        expect(screen.getByText("Add Precondition")).toBeInTheDocument();
      });
    });

    it("does not show field/rule dropdowns in collapsed state", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      await waitFor(() => {
        expect(
          screen.getByText(
            "This evaluation will run on every application trace",
          ),
        ).toBeInTheDocument();
      });

      // No "When" label should be visible (that belongs to expanded rows)
      expect(screen.queryByText("When")).not.toBeInTheDocument();
    });
  });

  describe("when Add Precondition is clicked", () => {
    it("expands the form showing the origin row and a new empty row", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // Should show "When" for first row and "and" for second
      await waitFor(() => {
        expect(screen.getByText("When")).toBeInTheDocument();
        expect(screen.getByText("and")).toBeInTheDocument();
      });
    });
  });

  describe("when field dropdown is opened", () => {
    it("shows all 18 fields grouped by category", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      // Expand preconditions
      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // The second row (new one) should have a field selector with all fields
      // Find the field select elements - there should be 2 (one per precondition row)
      const fieldSelects = screen.getAllByRole("combobox");

      // Find the field select for the new row (the third combobox - first two are field and rule of the origin row)
      // Actually, let's check for optgroups in any of the field selects
      // The new row's field select should contain optgroups
      const selectWithOptgroups = fieldSelects.find((select) =>
        within(select).queryByText("Input"),
      );
      expect(selectWithOptgroups).toBeDefined();

      // Check that all categories are present
      // We check for representative fields from each category:
      // Trace: Input, Output, Origin, Contains Error
      // Metadata: Labels, User ID, Thread ID, Customer ID, Prompt IDs, Metadata Value
      // Spans: Span Type, Model
      // Topics: Topics, Subtopics
      // Annotations: Has Annotation
      // Events: Event Type, Event Metrics Key, Event Details Key
      const fieldOptions = selectWithOptgroups!.querySelectorAll("option");
      const optionTexts = Array.from(fieldOptions).map(
        (o) => o.textContent,
      );

      expect(optionTexts).toContain("Input");
      expect(optionTexts).toContain("Output");
      expect(optionTexts).toContain("Origin");
      expect(optionTexts).toContain("Contains Error");
      expect(optionTexts).toContain("Label");
      expect(optionTexts).toContain("User ID");
      expect(optionTexts).toContain("Thread ID");
      expect(optionTexts).toContain("Customer ID");
      expect(optionTexts).toContain("Prompt ID");
      expect(optionTexts).toContain("Span Type");
      expect(optionTexts).toContain("Model");
      expect(optionTexts).toContain("Topic");
      expect(optionTexts).toContain("Subtopic");
      expect(optionTexts).toContain("Metadata");
      expect(optionTexts).toContain("Annotations");
      expect(optionTexts).toContain("Event");
      expect(optionTexts).toContain("Metric");
      expect(optionTexts).toContain("Event Detail");
      expect(optionTexts).toHaveLength(18);
    });
  });

  describe("when selecting different fields", () => {
    it("defaults new precondition to metadata.labels with 3 rules", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      // Expand preconditions
      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // The new (second) row defaults to field "metadata.labels" which has 3 rules
      await waitFor(() => {
        expect(screen.getByText("and")).toBeInTheDocument();
      });

      // Get all comboboxes, find the rule select for the second precondition row
      const comboboxes = screen.getAllByRole("combobox");
      const secondRowRuleSelect = comboboxes[3]; // 0: row1-field, 1: row1-rule, 2: row2-field, 3: row2-rule
      expect(secondRowRuleSelect).toBeDefined();

      const ruleOptions = secondRowRuleSelect!.querySelectorAll("option");
      const ruleTexts = Array.from(ruleOptions).map((o) => o.textContent);
      expect(ruleTexts).toContain("contains");
      expect(ruleTexts).toContain("does not contain");
      expect(ruleTexts).toContain("is");
      expect(ruleTexts).toHaveLength(3);
    });

    it("filters rule dropdown for traces.origin to show only 'is'", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      // Expand preconditions
      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // The first row has field "traces.origin" with rule "is"
      // Check its rule select has only "is"
      const comboboxes = screen.getAllByRole("combobox");
      const firstRowRuleSelect = comboboxes[1]; // 0: row1-field, 1: row1-rule
      expect(firstRowRuleSelect).toBeDefined();

      const ruleOptions = firstRowRuleSelect!.querySelectorAll("option");
      const ruleTexts = Array.from(ruleOptions).map((o) => o.textContent);
      expect(ruleTexts).toEqual(["is"]);
    });
  });

  describe("when traces.error field is selected", () => {
    it("shows true/false selector instead of text input", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      // Expand preconditions
      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // Change the second row's field to "traces.error"
      const comboboxes = screen.getAllByRole("combobox");
      const secondRowFieldSelect = comboboxes[2]; // 0: row1-field, 1: row1-rule, 2: row2-field
      expect(secondRowFieldSelect).toBeDefined();

      await user.selectOptions(secondRowFieldSelect!, "traces.error");
      await vi.advanceTimersByTimeAsync(50);

      // After changing to traces.error, the value input should become a boolean selector
      // Find all comboboxes again (they may have changed)
      const updatedComboboxes = screen.getAllByRole("combobox");

      // For traces.error: row2 has field + rule + value(boolean) selects
      // Find the value select by checking for "true"/"false" options
      const booleanSelect = updatedComboboxes.find((select) => {
        const options = select.querySelectorAll("option");
        const texts = Array.from(options).map((o) => o.textContent);
        return texts.includes("true") && texts.includes("false") && texts.length === 2;
      });
      expect(booleanSelect).toBeDefined();
    });
  });

  describe("when removing custom preconditions", () => {
    it("collapses back to summary when only default precondition remains", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await setupWithEvaluator(user);

      // Expand preconditions
      await user.click(screen.getByText("Add Precondition"));
      await vi.advanceTimersByTimeAsync(50);

      // Verify expanded state
      await waitFor(() => {
        expect(screen.getByText("When")).toBeInTheDocument();
        expect(screen.getByText("and")).toBeInTheDocument();
      });

      // Find remove buttons (ghost buttons with SVG icon and no text content)
      const allButtons = screen.getAllByRole("button");
      const closeButtons = allButtons.filter((btn) => {
        const svg = btn.querySelector("svg");
        const text = btn.textContent?.trim();
        return svg !== null && (!text || text === "");
      });

      // The second close button removes the newly added precondition
      expect(closeButtons.length).toBeGreaterThanOrEqual(2);
      await user.click(closeButtons[closeButtons.length - 1]!);
      await vi.advanceTimersByTimeAsync(50);

      // Should collapse back to summary
      await waitFor(() => {
        expect(
          screen.getByText(
            "This evaluation will run on every application trace",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText("When")).not.toBeInTheDocument();
      });
    });
  });
});
