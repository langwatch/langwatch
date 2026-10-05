/**
 * The target picker's bulk actions, driven through the suite form hook that
 * feeds it in the form drawer.
 * @vitest-environment jsdom
 * @see specs/features/suites/target-selector-select-clear-all.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { useSuiteForm } from "../../../../../behavior/suite/use-suite-form.ts";
import { TargetPicker } from "../target-picker.tsx";

const AGENTS = [
  { id: "agent_1", name: "Support agent", type: "http" },
  { id: "agent_2", name: "Sales agent", type: "http" },
  { id: "agent_3", name: "Billing workflow", type: "workflow" },
];
const PROMPTS = [
  { id: "prompt_1", handle: "triage" },
  { id: "prompt_2", handle: "summary" },
];

function SuiteFormTargets() {
  const suiteForm = useSuiteForm({
    suite: null,
    isOpen: true,
    suiteId: undefined,
    scenarios: [],
    agents: AGENTS,
    prompts: PROMPTS,
  });

  return (
    <TargetPicker
      targets={suiteForm.filteredTargets}
      selectedTargets={suiteForm.selectedTargets}
      totalCount={suiteForm.availableTargets.length}
      isTargetSelected={suiteForm.isTargetSelected}
      onToggle={suiteForm.toggleTarget}
      onSelectAll={suiteForm.selectAllTargets}
      onClear={suiteForm.clearTargets}
      searchQuery={suiteForm.targetSearch}
      onSearchChange={suiteForm.setTargetSearch}
      onAddTarget={() => undefined}
    />
  );
}

afterEach(cleanup);

describe("<TargetPicker/> in the suite form", () => {
  describe("when no targets are selected and Select All is clicked", () => {
    /** @scenario "Clicking Select All selects all targets" */
    it("selects all 5 targets and counts them in the footer", async () => {
      renderWithDesignSystem(<SuiteFormTargets />);
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(5);
      expect(screen.getByText("0 of 5 selected")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Select All" }));

      expect(await screen.findByText("5 of 5 selected")).toBeInTheDocument();
      for (const checkbox of screen.getAllByRole("checkbox")) {
        expect(checkbox).toBeChecked();
      }
    });
  });

  describe("when all 5 targets are selected and Clear is clicked", () => {
    /** @scenario "Clicking Clear deselects all targets" */
    it("deselects every target and counts none in the footer", async () => {
      renderWithDesignSystem(<SuiteFormTargets />);
      await userEvent.click(screen.getByRole("button", { name: "Select All" }));
      expect(await screen.findByText("5 of 5 selected")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(await screen.findByText("0 of 5 selected")).toBeInTheDocument();
      for (const checkbox of screen.getAllByRole("checkbox")) {
        expect(checkbox).not.toBeChecked();
      }
    });
  });
});
